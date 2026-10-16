export const BULK_MAIL_RECIPIENT_LIMIT = 100;

export class BulkMailValidationError extends Error {
    constructor(code, details = {}) {
        super(code);
        this.name = 'BulkMailValidationError';
        this.code = code;
        Object.assign(this, details);
    }
}

export function createBulkMailDraft() {
    return {
        fromMail: '', fromName: '', subject: '', contentType: 'text', content: '',
        variables: [], recipients: [],
    };
}

export function nextBulkMailVariable(variables) {
    const used = new Set(variables);
    let number = 1;
    while (used.has(`var${number}`)) number++;
    return `var${number}`;
}

function isEmail(value) {
    if (value.length > 254 || /[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
    const parts = value.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    // Bare dot-atom addresses cover common mailboxes, including plus tags,
    // apostrophes and UTF-8 local parts, without accepting display-name syntax.
    if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')
        || !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.\u0080-\u{10FFFF}]+$/u.test(local)) return false;
    if (!domain || /[\s@:\/\\?#%\[\]<>]/u.test(domain)) return false;
    try {
        // URL performs IDNA conversion so international domain names receive
        // the same label checks as their ASCII/punycode equivalents.
        const hostname = new URL(`https://${domain}`).hostname;
        const labels = hostname.split('.');
        return hostname.length <= 253 && labels.length >= 2
            && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
    } catch {
        return false;
    }
}
const tokens = (value) => [...String(value ?? '').matchAll(/\{\{([^{}]*)\}\}/g)];
const normalizeContentText = value => String(value)
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ').trim();

export function parseRecipientEmails(text, existingEmails = []) {
    const seen = new Set(existingEmails.map(value => String(value).trim().toLowerCase()));
    const result = { emails: [], invalid: [], duplicates: [] };
    for (const value of String(text ?? '').split(/[\n\r,;]+/)) {
        const email = value.trim();
        if (!email) continue;
        if (!isEmail(email)) {
            result.invalid.push(email);
        } else if (seen.has(email.toLowerCase())) {
            result.duplicates.push(email);
        } else {
            seen.add(email.toLowerCase());
            result.emails.push(email);
        }
    }
    return result;
}

function fail(code, details) {
    throw new BulkMailValidationError(code, details);
}

function referencedVariables(value, draft, field) {
    const names = new Set();
    for (const match of tokens(value)) {
        const variable = match[1].trim();
        if (!/^var[1-9]\d*$/.test(variable) || !draft.variables.includes(variable)) {
            fail('unknown_variable', { variable, field });
        }
        names.add(variable);
    }
    return names;
}

// Check the source as well as the DOM: HTML parsing can discard placeholders
// in malformed tags, so checking attributes after parsing alone is insufficient.
function checkHtmlSource(content) {
    for (let index = 0; index < content.length; index++) {
        if (content[index] !== '<' || !/^[A-Za-z!/?{]/.test(content.slice(index + 1))) continue;
        const start = index;
        if (content.startsWith('<!--', index)) {
            const end = content.indexOf('-->', index + 4);
            index = end < 0 ? content.length : end + 2;
        } else {
            let quote = '';
            for (index++; index < content.length; index++) {
                const character = content[index];
                if (quote) {
                    if (character === quote) quote = '';
                } else if (character === '"' || character === "'") {
                    quote = character;
                } else if (character === '>') {
                    break;
                }
            }
        }
        if (tokens(content.slice(start, index + 1)).length) {
            fail('invalid_variable_context', { field: 'content' });
        }
    }
}

const forbiddenTextParents = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
    'TEXTAREA', 'TITLE', 'XMP', 'PLAINTEXT', 'NOEMBED', 'NOFRAMES',
]);

function htmlDocument(content) {
    checkHtmlSource(content);
    // Template contents remain inert while validating and personalizing markup.
    const container = document.createElement('template');
    container.innerHTML = content;
    function validate(node, forbidden = false) {
        if (node.nodeType === 1) {
            forbidden ||= forbiddenTextParents.has(node.tagName.toUpperCase());
            for (const attribute of node.attributes) {
                if (tokens(attribute.value).length || tokens(attribute.name).length) {
                    fail('invalid_variable_context', { field: 'content' });
                }
            }
            // Template descendants live in a separate DocumentFragment.
            if (node.tagName === 'TEMPLATE' && tokens(node.innerHTML).length) {
                fail('invalid_variable_context', { field: 'content' });
            }
        }
        if ((node.nodeType === 8 || forbidden) && tokens(node.textContent).length) {
            fail('invalid_variable_context', { field: 'content' });
        }
        for (const child of node.childNodes) validate(child, forbidden);
    }
    validate(container.content);
    return container;
}

function htmlVariables(container, draft) {
    const walker = document.createTreeWalker(container.content, 4 /* SHOW_TEXT */);
    const ranges = [];
    let text = '';
    while (walker.nextNode()) {
        const start = text.length;
        text += walker.currentNode.textContent;
        ranges.push({ start, end: text.length });
    }
    for (const match of tokens(text)) {
        const end = match.index + match[0].length;
        if (!ranges.some(range => match.index >= range.start && end <= range.end)) {
            fail('invalid_variable_context', { field: 'content', variable: match[1].trim() });
        }
    }
    return referencedVariables(text, draft, 'content');
}

function hasHtmlContent(container) {
    const visible = container.content.cloneNode(true);
    visible.querySelectorAll('script,style,noscript,template,title').forEach(node => node.remove());
    return normalizeContentText(visible.textContent).length > 0
        || Boolean(visible.querySelector('img,audio,video,iframe,svg,canvas,table'));
}

function validateTemplate(draft) {
    if (!isEmail(String(draft.fromMail ?? '').trim())) fail('from_required', { field: 'fromMail' });
    if (!normalizeContentText(draft.subject ?? '')) fail('subject_required', { field: 'subject' });
    if (!normalizeContentText(draft.content ?? '')) fail('content_required', { field: 'content' });
    const variables = new Set(referencedVariables(draft.subject, draft, 'subject'));
    if (draft.contentType === 'text') {
        for (const name of referencedVariables(draft.content, draft, 'content')) variables.add(name);
    } else {
        const container = htmlDocument(draft.content);
        // Entity-encoded braces become placeholders in the DOM too.
        for (const name of htmlVariables(container, draft)) variables.add(name);
        if (!hasHtmlContent(container)) fail('content_required', { field: 'content' });
    }
    return variables;
}

function renderRow(draft, row, variables) {
    const email = String(row.email ?? '').trim();
    if (!isEmail(email)) fail('invalid_email', { recipientId: row.id, field: 'email' });
    for (const variable of variables) {
        if (!normalizeContentText(row.values?.[variable] ?? '')) {
            fail('missing_variable', { recipientId: row.id, variable });
        }
    }
    // One replacement pass keeps values containing {{varN}} as literal text.
    const replace = value => String(value).replace(/\{\{([^{}]*)\}\}/g,
        (_, name) => row.values[name.trim()]);
    let content;
    if (draft.contentType === 'text') {
        content = replace(draft.content);
    } else {
        const container = htmlDocument(draft.content);
        const walker = document.createTreeWalker(container.content, 4 /* SHOW_TEXT */);
        while (walker.nextNode()) walker.currentNode.textContent = replace(walker.currentNode.textContent);
        content = container.innerHTML;
    }
    return {
        id: row.id,
        email,
        payload: {
            from_mail: draft.fromMail.trim(), from_name: draft.fromName || '',
            to_mail: email, to_name: '', subject: replace(draft.subject), content,
            is_html: draft.contentType !== 'text',
        },
    };
}

export function renderBulkMailMessage(draft, row) {
    return renderRow(draft, row, validateTemplate(draft));
}

export function buildBulkMailMessages(draft) {
    if (!draft.recipients.length) fail('recipients_required');
    if (draft.recipients.length > BULK_MAIL_RECIPIENT_LIMIT) fail('recipients_limit');
    const variables = validateTemplate(draft);
    const seen = new Set();
    return draft.recipients.map(row => {
        const email = String(row.email ?? '').trim().toLowerCase();
        if (seen.has(email)) fail('duplicate_email', { recipientId: row.id, field: 'email' });
        seen.add(email);
        return renderRow(draft, row, variables);
    });
}
