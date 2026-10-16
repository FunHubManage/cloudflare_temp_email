// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
    buildBulkMailMessages, BulkMailValidationError, createBulkMailDraft,
    nextBulkMailVariable, parseRecipientEmails, renderBulkMailMessage,
} from '../bulk-mail';

function draft(overrides = {}) {
    return {
        ...createBulkMailDraft(), fromMail: 'sender@example.com', subject: 'Hello {{var1}}',
        content: 'Your channel: {{var2}}. {{var1}}!', variables: ['var1', 'var2'],
        recipients: [
            { id: 'a', email: 'alice@example.com', values: { var1: 'Alice', var2: 'Art' } },
            { id: 'b', email: 'bob@example.com', values: { var1: 'Bob', var2: 'Food' } },
        ], ...overrides,
    };
}

function validation(fn, code, details = {}) {
    expect(fn).toThrow(BulkMailValidationError);
    try { fn(); } catch (error) { expect(error).toMatchObject({ code, ...details }); }
}

describe('bulk mail recipients', () => {
    it.each([
        'a..b@example.com', '.alice@example.com', 'alice.@example.com',
        'a@example..com', 'a@.example.com', 'a@example.com.', 'a@example.com:123',
        'a@-example.com', 'a@example-.com', 'a@exam_ple.com', 'a@localhost',
        'a@https://example.com', 'a@user:password@example.com',
        `a@${'x'.repeat(64)}.com`, `${'x'.repeat(65)}@example.com`,
        'a(b)@example.com', '"alice"@example.com', 'alice\u200b@example.com',
    ])('rejects malformed bare email addresses: %s', email => {
        expect(parseRecipientEmails(email)).toMatchObject({ emails: [], invalid: [email] });
        const data = draft();
        data.recipients[0].email = email;
        validation(() => buildBulkMailMessages(data), 'invalid_email', { recipientId: 'a' });
    });

    it.each([
        'alice+creators@example.com', "o'connor@example.com", 'first.last@example.co.uk',
        'creator/name@example.com', 'user!tag@example.com', 'hello@例子.公司',
        '创作者@example.com', 'hello@xn--fsqu00a.xn--55qx5d',
    ])('accepts common dot-atom addresses and international domain names: %s', email => {
        expect(parseRecipientEmails(email)).toEqual({ emails: [email], invalid: [], duplicates: [] });
    });

    it('splits pasted addresses, deduplicates case-insensitively, and reports invalid addresses', () => {
        expect(parseRecipientEmails(' Alice@example.com, bob@example.com;ALICE@example.com\ninvalid\r\ncarol@example.com', ['BOB@example.com']))
            .toEqual({ emails: ['Alice@example.com', 'carol@example.com'], duplicates: ['bob@example.com', 'ALICE@example.com'], invalid: ['invalid'] });
    });

    it('requires between 1 and 100 recipients', () => {
        validation(() => buildBulkMailMessages(draft({ recipients: [] })), 'recipients_required');
        const recipients = Array.from({ length: 100 }, (_, index) => ({ id: `${index}`, email: `person${index}@example.com`, values: {} }));
        expect(buildBulkMailMessages(draft({ subject: 'Hello', content: 'Content', recipients }))).toHaveLength(100);
        validation(() => buildBulkMailMessages(draft({ recipients: [...recipients, recipients[0]] })), 'recipients_limit');
    });

    it('rejects invalid and duplicate manually entered rows and locates them', () => {
        const data = draft();
        data.recipients[1].email = 'ALICE@example.com';
        validation(() => buildBulkMailMessages(data), 'duplicate_email', { recipientId: 'b' });
        data.recipients[1].email = 'bad address';
        validation(() => buildBulkMailMessages(data), 'invalid_email', { recipientId: 'b' });
    });
});

describe('bulk mail templates', () => {
    it('starts at var1 and reuses the lowest deleted variable number without renumbering existing variables', () => {
        const variables = [];
        variables.push(nextBulkMailVariable(variables));
        variables.push(nextBulkMailVariable(variables));
        variables.push(nextBulkMailVariable(variables));
        expect(variables).toEqual(['var1', 'var2', 'var3']);

        variables.splice(1, 1);
        expect(nextBulkMailVariable(variables)).toBe('var2');
        expect(variables).toEqual(['var1', 'var3']);

        variables.length = 0;
        expect(nextBulkMailVariable(variables)).toBe('var1');
    });

    it('ignores legacy draft counters and finds unused numbers from restored variable columns', () => {
        const restoredDraft = { ...createBulkMailDraft(), nextVariableId: 90, variables: ['var3', 'var2'] };
        expect(nextBulkMailVariable(restoredDraft.variables)).toBe('var1');
        restoredDraft.variables.push('var1');
        expect(nextBulkMailVariable(restoredDraft.variables)).toBe('var4');
    });

    it('renders one independent payload per person and personalizes subject and body', () => {
        const data = draft();
        const messages = buildBulkMailMessages(data);
        expect(messages.map(message => message.payload.to_mail)).toEqual(['alice@example.com', 'bob@example.com']);
        expect(messages[0].payload).toMatchObject({ subject: 'Hello Alice', content: 'Your channel: Art. Alice!', is_html: false, to_name: '' });
        expect(messages[1].payload).toMatchObject({ subject: 'Hello Bob', content: 'Your channel: Food. Bob!' });
        expect(renderBulkMailMessage(data, data.recipients[0])).toEqual(messages[0]);
    });

    it('does not recursively substitute placeholders introduced by recipient values', () => {
        const data = draft();
        data.recipients[0].values.var1 = '{{var2}}';
        expect(buildBulkMailMessages(data)[0].payload.subject).toBe('Hello {{var2}}');
    });

    it('reports deleted, unknown and missing variables with the corresponding field or row', () => {
        validation(() => buildBulkMailMessages(draft({ variables: ['var2'] })), 'unknown_variable', { variable: 'var1', field: 'subject' });
        validation(() => buildBulkMailMessages(draft({ subject: '{{nickname}}' })), 'unknown_variable', { variable: 'nickname' });
        const data = draft();
        data.recipients[1].values.var2 = '   ';
        validation(() => buildBulkMailMessages(data), 'missing_variable', { recipientId: 'b', variable: 'var2' });
    });

    it.each([
        [{ fromMail: '' }, 'from_required'],
        [{ subject: ' ' }, 'subject_required'],
        [{ content: '\n' }, 'content_required'],
        [{ content: '\u200b\uFEFF' }, 'content_required'],
        [{ contentType: 'rich', content: '<p><br></p>' }, 'content_required'],
    ])('requires sender, subject and actual content: %j', (change, code) => {
        validation(() => buildBulkMailMessages(draft(change)), code);
    });

    it('escapes HTML variable values as text while preserving template markup', () => {
        const data = draft({ contentType: 'html', content: '<p>Hello <b>{{var1}}</b> &amp; {{var2}}</p>' });
        data.recipients[0].values.var1 = '<img src=x onerror=alert(1)>';
        data.recipients[0].values.var2 = 'Tea & Cake';
        expect(buildBulkMailMessages(data)[0].payload).toMatchObject({
            is_html: true,
            content: '<p>Hello <b>&lt;img src=x onerror=alert(1)&gt;</b> &amp; Tea &amp; Cake</p>',
        });
    });

    it.each([
        '<script>alert(1)</script>', '<style>p { color:red }</style>',
        '<noscript>fallback</noscript>', '<template><p>hidden</p><img src="x"></template>',
        '<title>Document title</title>', '<p>&nbsp;&#8203;&#xfeff;</p>',
        '<script>hidden</script><style>hidden</style><p> </p>',
    ])('rejects HTML containing only nonvisible content: %s', content => {
        validation(() => buildBulkMailMessages(draft({ contentType: 'html', content })), 'content_required');
    });

    it.each([
        '<img src="https://example.com/image.png">', '<svg></svg>',
        '<canvas></canvas>', '<audio src="https://example.com/audio.mp3"></audio>',
        '<video src="https://example.com/video.mp4"></video>', '<table><tr><td></td></tr></table>',
    ])('preserves meaningful media-only HTML: %s', content => {
        expect(buildBulkMailMessages(draft({ contentType: 'html', content }))).toHaveLength(2);
    });

    it.each([
        '<b>{{var</b>1}}', '{{var<b>1</b>}}', '<b>&#123;&#123;var</b>1&#125;&#125;',
        '{{var<!-- a comment -->1}}',
    ])('rejects placeholder tokens split across HTML text nodes: %s', content => {
        validation(() => buildBulkMailMessages(draft({ contentType: 'rich', content })), 'invalid_variable_context');
    });

    it.each([
        '<a href="{{var1}}">link</a>',
        '<a title="x > {{var1}}">link</a>',
        '<!-- {{var1}} -->text',
        '<script>const x = "{{var1}}"</script>',
        '<style>.a { color: {{var1}}; }</style>',
        '<template><p>{{var1}}</p></template>',
        '<{{var1}}>text',
        '<a href="&#123;&#123;var1&#125;&#125;">link</a>',
    ])('rejects variables outside HTML text: %s', content => {
        validation(() => buildBulkMailMessages(draft({ contentType: 'rich', content })), 'invalid_variable_context');
    });

    it('handles HTML entity-encoded variables in text without escaping markup twice', () => {
        const data = draft({ contentType: 'html', content: '<p>&#123;&#123;var2&#125;&#125;</p>' });
        expect(buildBulkMailMessages(data)[0].payload.content).toBe('<p>Art</p>');
    });
});
