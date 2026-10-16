import { expect, test, type Page, type Route } from '@playwright/test';

import { FRONTEND_URL } from '../../fixtures/test-helpers';

type SentMessage = {
  from_mail: string;
  from_name: string;
  to_mail: string;
  to_name: string;
  subject: string;
  content: string;
  is_html: boolean;
};

// Every API request is fulfilled locally, including every send request. These
// browser tests never connect to an SMTP server or a deployed Worker.
async function mockApi(page: Page, send?: (route: Route, message: SentMessage) => Promise<void>) {
  await page.route('**/*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/admin/send_mail') {
      if (send) return await send(route, route.request().postDataJSON());
      return await route.fulfill({ status: 500, body: 'Unexpected mocked send' });
    }
    if (['/open_api/', '/admin/', '/api/', '/user_api/', '/external/'].some(prefix => pathname.startsWith(prefix))) {
      const data = pathname === '/open_api/settings' ? {
        domains: ['example.com'], defaultDomains: ['example.com'],
        enableSendMail: true, enableUserCreateEmail: true,
        disableAdminPasswordCheck: false, showGithub: false,
        title: 'Bulk mail browser test',
      } : { results: [], count: 0 };
      return await route.fulfill({ json: data });
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__bulkMailTestInitialized')) {
      localStorage.setItem('adminAuth', 'mock-admin-password');
      sessionStorage.setItem('adminTab', 'mails');
      sessionStorage.setItem('__bulkMailTestInitialized', '1');
    }
  });
}

async function openBulkMail(page: Page) {
  await page.goto(`${FRONTEND_URL}/en/admin`);
  await page.locator('.n-tabs-tab').filter({ hasText: /^Bulk mail$/ }).click();
  await expect(page.getByRole('heading', { name: 'Bulk mail', exact: true })).toBeVisible();
}

async function openRecipientImport(page: Page) {
  await page.getByRole('button', { name: 'More ways to add recipients', exact: true }).click();
  await page.getByText('Add multiple recipients', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add multiple recipients', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function importRecipients(page: Page, recipients: string) {
  const dialog = await openRecipientImport(page);
  await dialog.getByRole('textbox', { name: 'Paste recipient addresses', exact: true }).fill(recipients);
  await dialog.getByRole('button', { name: 'Add addresses', exact: true }).click();
  return dialog;
}

async function compose(page: Page, recipients = 'first@example.net;second@example.net') {
  await page.locator('#bulk-mail-from').fill('outreach@example.com');
  const dialog = await importRecipients(page, recipients);
  await expect(dialog).not.toBeVisible();
  await page.locator('#bulk-mail-subject').fill('Creator invitation');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Would you like to collaborate?');
}

const resultRow = (page: Page, email: string) => page.locator('.results-table tbody tr').filter({ hasText: email });

test.describe('Admin bulk mail with mocked sending', () => {
  test('adds individual rows below the table and imports recipients from the split button menu', async ({ page }) => {
    await mockApi(page);
    await openBulkMail(page);
    await expect(page.locator('.recipient-table')).toBeVisible();
    await page.getByRole('button', { name: 'Add recipient', exact: true }).click();
    await expect(page.locator('.recipient-table tbody tr')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Email address for recipient 1', exact: true }).fill('single@example.net');
    const table = await page.locator('.recipient-table').boundingBox();
    const add = await page.getByRole('button', { name: 'Add recipient', exact: true }).boundingBox();
    expect(table).not.toBeNull();
    expect(add).not.toBeNull();
    expect(add!.y).toBeGreaterThanOrEqual(table!.y + table!.height);
    expect(add!.x).toBeLessThanOrEqual(table!.x + 24);

    const dialog = await importRecipients(page, 'single@example.net;second@example.net;invalid-address');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Paste recipient addresses', exact: true })).toHaveValue('invalid-address');
    await expect(page.locator('.recipient-table tbody tr')).toHaveCount(2);
    await expect(page.getByText('Skipped 1 duplicate addresses.', { exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Paste recipient addresses', exact: true }).fill('third@example.net');
    await dialog.getByRole('button', { name: 'Add addresses', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.recipient-table tbody tr')).toHaveCount(3);
    expect(await page.evaluate(() => sessionStorage.getItem('adminBulkMailJob'))).toBeNull();
  });

  test('deduplicates pasted addresses, personalizes messages, and survives switching tabs', async ({ page }) => {
    const sent: SentMessage[] = [];
    const startedAt: number[] = [];
    let firstFinishedAt = 0;
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    await mockApi(page, async (route, mail) => {
      sent.push(mail);
      startedAt.push(Date.now());
      if (sent.length === 1) await firstPending;
      await route.fulfill({ json: { status: 'ok' } });
      if (sent.length === 1) firstFinishedAt = Date.now();
    });
    await openBulkMail(page);
    await compose(page, 'First@example.net,first@EXAMPLE.net;second@example.net');
    await expect(page.locator('.recipient-table tbody tr')).toHaveCount(2);
    await expect(page.getByText('Skipped 1 duplicate addresses.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await page.getByRole('textbox', { name: 'var1 for recipient 1', exact: true }).fill('Alice');
    await page.getByRole('textbox', { name: 'var1 for recipient 2', exact: true }).fill('Bob');
    await page.getByRole('textbox', { name: 'var2 for recipient 1', exact: true }).fill('art');
    await page.getByRole('textbox', { name: 'var2 for recipient 2', exact: true }).fill('music');
    await page.locator('#bulk-mail-subject').fill('Hello {{var1}}');
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('I enjoyed your {{var2}}.');
    await expect(page.locator('.preview-subject')).toContainText('Hello Alice');
    await expect(page.locator('.text-preview')).toHaveText('I enjoyed your art.');
    await page.locator('.preview-select').click();
    await page.locator('.n-base-select-option').filter({ hasText: /^second@example.net$/ }).click();
    await expect(page.locator('.preview-subject')).toContainText('Hello Bob');
    await expect(page.locator('.text-preview')).toHaveText('I enjoyed your music.');
    await page.locator('.preview-select').click();
    await page.locator('.n-base-select-option').filter({ hasText: /^First@example.net$/ }).click();
    await page.screenshot({ path: '/tmp/cf-temp-mail-bulk-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Start sending (2)', exact: true }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => sent.length).toBe(1);
    await expect(page.locator('#bulk-mail-subject')).toBeDisabled();
    await page.locator('.n-tabs-tab').filter({ hasText: /^Send Mail$/ }).click();
    await expect(page.getByRole('heading', { name: 'Compose email', exact: true })).toBeVisible();
    await page.locator('.n-tabs-tab').filter({ hasText: /^Bulk mail$/ }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: /Resume \(1 pending\)$/ })).toBeDisabled();
    releaseFirst();
    await expect(resultRow(page, 'First@example.net')).toContainText('Success');
    await expect(resultRow(page, 'second@example.net')).toContainText('Pending');
    await page.getByRole('button', { name: /Resume \(1 pending\)$/ }).click();
    await expect(resultRow(page, 'second@example.net')).toContainText('Success');
    expect(sent).toHaveLength(2);
    expect(sent.map(mail => [mail.to_mail, mail.subject, mail.content])).toEqual([
      ['First@example.net', 'Hello Alice', 'I enjoyed your art.'],
      ['second@example.net', 'Hello Bob', 'I enjoyed your music.'],
    ]);
    expect(sent.every(mail => typeof mail.to_mail === 'string' && !mail.to_mail.includes(','))).toBe(true);
    expect(startedAt[1] - firstFinishedAt).toBeGreaterThanOrEqual(1900);
  });

  test('continues sending while a different main admin tab is open', async ({ page }) => {
    const sent: string[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    await mockApi(page, async (route, mail) => {
      sent.push(mail.to_mail);
      if (sent.length === 1) await firstPending;
      await route.fulfill({ json: { status: 'ok' } });
    });
    await openBulkMail(page);
    await compose(page);
    await page.getByRole('button', { name: 'Start sending (2)', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    await page.locator('.n-tabs-tab').filter({ hasText: /^Appearance$/ }).click();
    releaseFirst();
    await expect.poll(() => sent.length).toBe(2);
    await page.locator('.n-tabs-tab').filter({ hasText: /^Emails$/ }).first().click();
    await page.locator('.n-tabs-tab').filter({ hasText: /^Bulk mail$/ }).click();
    await expect(resultRow(page, 'first@example.net')).toContainText('Success');
    await expect(resultRow(page, 'second@example.net')).toContainText('Success');
    expect(sent).toEqual(['first@example.net', 'second@example.net']);
  });

  test('personalizes rich text as escaped text and sends an HTML message', async ({ page }) => {
    const sent: SentMessage[] = [];
    await mockApi(page, async (route, mail) => {
      sent.push(mail);
      await route.fulfill({ json: { status: 'ok' } });
    });
    await openBulkMail(page);
    await compose(page, 'rich@example.net');
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await page.getByRole('textbox', { name: 'var1 for recipient 1', exact: true }).fill('Alice <creator>');
    await page.getByText('Rich text', { exact: true }).click();
    const editor = page.locator('.bulk-mail-page .w-e-text-container [contenteditable="true"]');
    await editor.fill('Hello {{var1}}');
    await expect(page.locator('.html-preview')).toContainText('Hello Alice <creator>');
    await page.getByRole('button', { name: 'Start sending (1)', exact: true }).click();
    await expect(resultRow(page, 'rich@example.net')).toContainText('Success');
    expect(sent).toHaveLength(1);
    expect(sent[0].is_html).toBe(true);
    expect(sent[0].content).toContain('Hello Alice &lt;creator&gt;');
  });

  test('reuses deleted variable IDs without stale values and blocks invalid templates', async ({ page }) => {
    let sends = 0;
    await mockApi(page, async route => { sends++; await route.fulfill({ json: { status: 'ok' } }); });
    await openBulkMail(page);
    await compose(page, 'one@example.net');
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await page.getByRole('textbox', { name: 'var1 for recipient 1', exact: true }).fill('Deleted value');
    await page.getByRole('button', { name: 'Remove var1 column', exact: true }).click();
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await expect(page.locator('.recipient-table thead')).toContainText('{{var2}}');
    await expect(page.locator('.recipient-table thead')).toContainText('{{var1}}');
    await expect(page.locator('.recipient-table thead')).not.toContainText('{{var3}}');
    await expect(page.getByRole('textbox', { name: 'var1 for recipient 1', exact: true })).toHaveValue('');
    await page.locator('#bulk-mail-subject').fill('Hello {{var2}}');
    await page.getByRole('button', { name: 'Start sending (1)', exact: true }).click();
    await expect(page.locator('.bulk-notice[role=alert]').filter({ hasText: 'is missing a value for var2' })).toBeVisible();
    await page.getByRole('textbox', { name: 'var2 for recipient 1', exact: true }).fill('Alice <creator>');
    await page.locator('#bulk-mail-subject').fill('{{var3}}');
    await page.getByRole('button', { name: 'Start sending (1)', exact: true }).click();
    await expect(page.locator('.bulk-notice[role=alert]').filter({ hasText: 'unknown variable, var3' })).toBeVisible();
    await page.locator('#bulk-mail-subject').fill('Hello {{var2}}');
    await page.getByText('HTML', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('<a href="{{var2}}">Link</a>');
    await page.getByRole('button', { name: 'Start sending (1)', exact: true }).click();
    await expect(page.locator('.bulk-notice[role=alert]').filter({ hasText: 'A variable appears in HTML markup' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('<p>Hello {{var2}}</p>');
    await expect(page.locator('.html-preview')).toContainText('Hello Alice <creator>');
    await page.getByRole('textbox', { name: 'var1 for recipient 1', exact: true }).fill('Another deleted value');
    await page.getByRole('button', { name: 'Remove var1 column', exact: true }).click();
    await page.getByRole('button', { name: 'Remove var2 column', exact: true }).click();
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await expect(page.locator('.recipient-table thead')).toContainText('{{var1}}');
    await expect(page.locator('.recipient-table thead')).not.toContainText('{{var2}}');
    await expect(page.getByRole('textbox', { name: 'var1 for recipient 1', exact: true })).toHaveValue('');
    expect(sends).toBe(0);
  });

  for (const status of [400, 401, 429]) {
    test(`pauses on HTTP ${status} without retries and resumes pending recipients only`, async ({ page }) => {
      const sent: string[] = [];
      await mockApi(page, async (route, mail) => {
        sent.push(mail.to_mail);
        if (sent.length === 1) {
          // No auth-refresh interception should resend this mutation.
          await route.fulfill({ status, json: { code: status === 401 ? 'AUTH_USER_ACCESS_TOKEN_EXPIRED' : 'MOCK_ERROR', message: `Mock failure ${status}` } });
        } else await route.fulfill({ json: { status: 'ok' } });
      });
      await openBulkMail(page);
      await compose(page);
      await page.getByRole('button', { name: 'Start sending (2)', exact: true }).click();
      await expect(resultRow(page, 'first@example.net')).toContainText(status === 400 ? 'Unconfirmed' : 'Failed');
      await expect(resultRow(page, 'first@example.net')).toContainText(`Mock failure ${status}`);
      await expect(resultRow(page, 'second@example.net')).toContainText('Pending');
      expect(sent).toEqual(['first@example.net']);
      await page.getByRole('button', { name: /Resume \(1 pending\)$/ }).click();
      await expect(resultRow(page, 'second@example.net')).toContainText('Success');
      expect(sent).toEqual(['first@example.net', 'second@example.net']);
    });
  }

  for (const failure of ['server', 'network']) {
    test(`treats ${failure} errors as unconfirmed and does not retry`, async ({ page }) => {
      const sent: string[] = [];
      await mockApi(page, async (route, mail) => {
        sent.push(mail.to_mail);
        if (sent.length === 1) {
          if (failure === 'network') await route.abort('failed');
          else await route.fulfill({ status: 500, body: 'Mock server failure' });
        } else await route.fulfill({ json: { status: 'ok' } });
      });
      await openBulkMail(page);
      await compose(page);
      await page.getByRole('button', { name: 'Start sending (2)', exact: true }).click();
      await expect(resultRow(page, 'first@example.net')).toContainText('Unconfirmed');
      await expect(resultRow(page, 'second@example.net')).toContainText('Pending');
      expect(sent).toEqual(['first@example.net']);
      await page.getByRole('button', { name: /Resume \(1 pending\)$/ }).click();
      await expect(resultRow(page, 'second@example.net')).toContainText('Success');
      expect(sent).toEqual(['first@example.net', 'second@example.net']);
    });
  }

  test('restores an in-flight request as unconfirmed after refresh and never resends it', async ({ page }) => {
    const sent: string[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    await mockApi(page, async (route, mail) => {
      sent.push(mail.to_mail);
      if (sent.length === 1) await firstPending;
      await route.fulfill({ json: { status: 'ok' } }).catch(() => {});
    });
    await openBulkMail(page);
    await compose(page);
    await page.getByRole('button', { name: 'Start sending (2)', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.n-tabs-tab').filter({ hasText: /^Bulk mail$/ }).click();
    await expect(resultRow(page, 'first@example.net')).toContainText('Unconfirmed');
    await expect(resultRow(page, 'second@example.net')).toContainText('Pending');
    await expect(page.getByRole('button', { name: /Resume \(1 pending\)$/ })).toBeEnabled();
    expect(sent).toEqual(['first@example.net']);
    releaseFirst();
    await page.getByRole('button', { name: /Resume \(1 pending\)$/ }).click();
    await expect(resultRow(page, 'second@example.net')).toContainText('Success');
    expect(sent).toEqual(['first@example.net', 'second@example.net']);
  });

  test('pauses when admin credentials change and when leaving the admin route', async ({ page }) => {
    const sent: string[] = [];
    await mockApi(page, async (route, mail) => { sent.push(mail.to_mail); await route.fulfill({ json: { status: 'ok' } }); });
    await openBulkMail(page);
    await compose(page);
    await page.getByRole('button', { name: 'Start sending (2)', exact: true }).click();
    await expect(resultRow(page, 'first@example.net')).toContainText('Success');
    await page.evaluate(() => {
      localStorage.setItem('adminAuth', 'changed-mock-password');
      window.dispatchEvent(new StorageEvent('storage', { key: 'adminAuth', newValue: 'changed-mock-password', storageArea: localStorage }));
    });
    await expect(page.getByRole('alert').filter({ hasText: 'admin access changed' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Resume \(1 pending\)$/ })).toBeEnabled();
    expect(sent).toEqual(['first@example.net']);
    await page.getByRole('button', { name: 'Mailbox', exact: true }).click();
    await expect(page).toHaveURL(`${FRONTEND_URL}/en/`);
    await page.getByRole('button', { name: 'Admin Console', exact: true }).click();
    await page.locator('.n-tabs-tab').filter({ hasText: /^Bulk mail$/ }).click();
    await expect(resultRow(page, 'second@example.net')).toContainText('Pending');
    expect(sent).toEqual(['first@example.net']);
  });

  test('pauses a running batch when navigating away and ignores the detached response', async ({ page }) => {
    const sent: string[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    await mockApi(page, async (route, mail) => {
      sent.push(mail.to_mail);
      if (sent.length === 1) await firstPending;
      await route.fulfill({ json: { status: 'ok' } });
    });
    await openBulkMail(page);
    await compose(page);
    await page.getByRole('button', { name: 'Start sending (2)', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    await page.getByRole('button', { name: 'Mailbox', exact: true }).click();
    await page.getByRole('button', { name: 'Admin Console', exact: true }).click();
    await page.locator('.n-tabs-tab').filter({ hasText: /^Bulk mail$/ }).click();
    await expect(resultRow(page, 'first@example.net')).toContainText('Unconfirmed');
    await expect(resultRow(page, 'second@example.net')).toContainText('Pending');
    await page.getByRole('button', { name: /Resume \(1 pending\)$/ }).click();
    releaseFirst();
    await expect(resultRow(page, 'second@example.net')).toContainText('Success');
    await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('adminBulkMailJob')!).items[1].status)).toBe('success');
    expect(sent).toEqual(['first@example.net', 'second@example.net']);
  });

  test('logs out without sending the remaining recipients', async ({ page }) => {
    const sent: string[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    await mockApi(page, async (route, mail) => {
      sent.push(mail.to_mail);
      await firstPending;
      await route.fulfill({ json: { status: 'ok' } });
    });
    await openBulkMail(page);
    await compose(page);
    await page.getByRole('button', { name: 'Start sending (2)', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    await page.locator('.n-tabs-tab').filter({ hasText: /^Admin$/ }).click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page).toHaveURL(`${FRONTEND_URL}/en/`);
    releaseFirst();
    expect(await page.evaluate(() => localStorage.getItem('adminAuth'))).toBe('');
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('adminBulkMailJob')!).state)).toBe('paused');
    expect(sent).toEqual(['first@example.net']);
  });

  test('keeps admin single send working and fits the bulk form on mobile', async ({ page }) => {
    const sent: SentMessage[] = [];
    await mockApi(page, async (route, mail) => { sent.push(mail); await route.fulfill({ json: { status: 'ok' } }); });
    await openBulkMail(page);
    await page.locator('.n-tabs-tab').filter({ hasText: /^Send Mail$/ }).click();
    await page.locator('#admin-send-mail-sender-address').fill('admin@example.com');
    await page.locator('#admin-send-mail-recipient-address').fill('single@example.net');
    await page.locator('#admin-send-mail-subject').fill('Single send regression');
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Still sends one message.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ to_mail: 'single@example.net', subject: 'Single send regression' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('.n-tabs-tab').filter({ hasText: /^Bulk mail$/ }).click();
    await compose(page, 'mobile@example.net');
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'var1 for recipient 1', exact: true })).toBeVisible();
    const mobileForm = await page.locator('.bulk-compose-form').boundingBox();
    const mobilePreview = await page.locator('.preview-panel').boundingBox();
    expect(mobileForm).not.toBeNull();
    expect(mobilePreview).not.toBeNull();
    expect(mobilePreview!.y).toBeGreaterThanOrEqual(mobileForm!.y + mobileForm!.height);
    await page.screenshot({ path: '/tmp/cf-temp-mail-bulk-mobile.png', fullPage: true });
    const start = page.getByRole('button', { name: 'Start sending (1)', exact: true });
    await start.scrollIntoViewIfNeeded();
    const startBox = await start.boundingBox();
    expect(startBox).not.toBeNull();
    expect(startBox!.x).toBeGreaterThanOrEqual(0);
    expect(startBox!.x + startBox!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(sent).toHaveLength(1);
  });

  test('rejects imports over 100 recipients and keeps bulk mail out of the mailbox UI', async ({ page }) => {
    await mockApi(page);
    await openBulkMail(page);
    const addresses = Array.from({ length: 101 }, (_, index) => `creator${index}@example.net`);
    const dialog = await importRecipients(page, addresses.join('\n'));
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Each batch supports up to 100 recipients' })).toBeVisible();
    await expect(page.locator('.recipient-table tbody tr')).toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Paste recipient addresses', exact: true }).fill(addresses.slice(0, 100).join('\n'));
    await dialog.getByRole('button', { name: 'Add addresses', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.recipient-table tbody tr')).toHaveCount(100);
    await expect(page.getByRole('button', { name: 'Add recipient', exact: true })).toBeDisabled();
    await page.goto(`${FRONTEND_URL}/en/`);
    await expect(page.locator('.n-tabs-tab').filter({ hasText: /^Bulk mail$/ })).toHaveCount(0);
  });

  test('keeps the wider desktop preview bounded and equal in height to the composer', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockApi(page);
    await openBulkMail(page);
    await compose(page, 'layout@example.net');
    const form = await page.locator('.bulk-compose-form').boundingBox();
    const preview = await page.locator('.preview-panel').boundingBox();
    expect(form).not.toBeNull();
    expect(preview).not.toBeNull();
    expect(preview!.x).toBeGreaterThanOrEqual(form!.x + form!.width);
    expect(Math.abs(preview!.y - form!.y)).toBeLessThanOrEqual(4);
    expect(Math.abs(preview!.height - form!.height)).toBeLessThanOrEqual(2);
    expect(preview!.width).toBeGreaterThan(form!.width);
    await page.setViewportSize({ width: 2200, height: 1000 });
    const wideForm = await page.locator('.bulk-compose-form').boundingBox();
    const widePreview = await page.locator('.preview-panel').boundingBox();
    const wideCard = await page.locator('.bulk-mail-card').boundingBox();
    expect(wideForm).not.toBeNull();
    expect(widePreview).not.toBeNull();
    expect(wideCard).not.toBeNull();
    expect(widePreview!.width).toBeGreaterThan(preview!.width);
    expect(widePreview!.width).toBeLessThanOrEqual(900);
    expect(wideCard!.width).toBeLessThanOrEqual(1680);
    expect(Math.abs(widePreview!.height - wideForm!.height)).toBeLessThanOrEqual(2);

    await page.getByRole('button', { name: 'Add recipient', exact: true }).click();
    const expandedForm = await page.locator('.bulk-compose-form').boundingBox();
    const expandedPreview = await page.locator('.preview-panel').boundingBox();
    expect(expandedForm).not.toBeNull();
    expect(expandedPreview).not.toBeNull();
    expect(expandedForm!.height).toBeGreaterThan(wideForm!.height);
    expect(Math.abs(expandedPreview!.height - expandedForm!.height)).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByText('HTML', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('<p>Long invitation preview.</p>'.repeat(100));
    const htmlPreview = page.locator('.html-preview');
    await expect(htmlPreview).toContainText('Long invitation preview.');
    await expect.poll(() => htmlPreview.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const htmlForm = await page.locator('.bulk-compose-form').boundingBox();
    const htmlPanel = await page.locator('.preview-panel').boundingBox();
    expect(htmlForm).not.toBeNull();
    expect(htmlPanel).not.toBeNull();
    expect(Math.abs(htmlPanel!.height - htmlForm!.height)).toBeLessThanOrEqual(2);
    await htmlPreview.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await htmlPreview.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await htmlPreview.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: '/tmp/cf-temp-mail-bulk-desktop.png', fullPage: true });
  });
});
