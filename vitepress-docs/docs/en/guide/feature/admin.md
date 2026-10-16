# Admin Console

> [!NOTE]
> You need to configure `ADMIN_PASSWORDS` or `ADMIN_USER_ROLE` to access the admin console
> Admin role configuration: if the user role equals ADMIN_USER_ROLE, they can access the admin console

After deploying the frontend application, click the upper-left logo 5 times or visit the `/admin` path to enter the Admin Console.

You need to configure `ADMIN_PASSWORDS` in the backend or ensure the current user role is `ADMIN_USER_ROLE`, otherwise access to the console will be denied.

## Admin Passwords vs User Accounts

`ADMIN_PASSWORDS` is the password for the Admin Console. It is not a site user account
and does not correspond to any mailbox. Logging in with an admin password grants access to
the console, but that login itself cannot receive mail.

Site user accounts are stored in the `users` table and use the user login flow. Whether a user can
receive mail depends on whether they created or bound a mailbox. Creating a normal user
whose account email is `admin@example.com` does not automatically grant admin permissions.

If you want a user account to access the Admin console, configure `ADMIN_USER_ROLE` and assign the
same role to that user in user management.

![admin](/feature/admin.png)

## Mailbox List Sorting

**Admin Console → Mailbox Management → Mailboxes** supports column sorting. Click a column header to toggle ascending/descending order for:

- ID
- Email Address
- Created At
- Updated At
- Mail Count
- Send Count

When searching for email addresses, pagination automatically resets to page 1.

## Bulk Mail

Open **Admin Console → Mail Management → Bulk Mail**, next to **Send Mail**. This feature is available to administrators only. It uses your existing [mail sending configuration](../config-send-mail) and requires no new environment variables, APIs or database migrations.

### Recipients and Personalized Content

1. Enter the sender address, sender name, subject and content. Plain text, HTML and rich text are supported.
2. Click **+** at the bottom left of the recipient table to add one row. Open the adjoining menu and choose **Add multiple recipients** to paste addresses in a dialog, one per line; commas and semicolons also work. Each batch supports up to 100 recipients. Pasting skips duplicates without case sensitivity and reports invalid addresses, leaving them in the paste field for correction. Invalid or duplicate addresses in the recipient table block sending.
3. Click **+** at the top right of the table to add variable columns, each with a fixed placeholder such as `{{var1}}` or `{{var2}}`. Fill in each recipient's values and use the placeholders in the subject or content to personalize their message. Use the remove button beside a column heading to delete that variable; other columns keep their numbers. New columns reuse the smallest available number, starting at `var1` after all columns are removed. Values must be entered again for a reused number.
4. Select a recipient in the preview and check their rendered subject and content before starting. On desktop, the narrower editor leaves more space for the right preview, which grows with the page up to 900px wide and matches the editor's height. Long messages scroll inside the preview. The preview moves below the editor on narrow screens and phones.

For example, use `{{var1}}, let's collaborate` as the subject and `We enjoyed your work on {{var2}}` in the content. Enter a different name and topic for each recipient to generate their message. Variable values are treated as plain text. In HTML and rich text, place variables in visible content, rather than tags, attributes or link URLs. Keep each placeholder intact; do not split it with formatting such as bold text.

### Progress and Recovery

Messages are sent one at a time, with only one recipient per message, so recipients cannot see one another. The next message starts at least 2 seconds after the previous one finishes. A started batch uses its confirmed content, independent of subsequent draft edits. Keep the browser page open. Sending continues when switching tabs within the Admin Console; leaving the console, logging out or changing identity pauses subsequent messages.

You can pause manually; the current request is allowed to finish. Any error also pauses the batch. A timeout, lost connection or uncertain provider result is marked **Unconfirmed** because the message may already have been sent. There are no automatic retries. Continuing sends only **Pending** messages and excludes failed, unconfirmed and successful messages.

Drafts and progress are stored in the current browser tab's session. After a refresh, the batch remains paused and any previously in-flight message becomes **Unconfirmed**. You can manually continue pending messages after checking the results. Sending does not run in the background, continue after the page closes or recover across devices.

Existing provider limits and site-wide daily/monthly limits still apply. Success means the provider accepted the message, rather than confirmed delivery or readership. Check sent items and the provider dashboard before deciding whether to send an unconfirmed message again.

## If your website is for private access only, you can disable this check

`DISABLE_ADMIN_PASSWORD_CHECK = true`

## IP Blacklist / Whitelist

Configure access control in Admin Console → **IP Blacklist Settings**. Applies to: create address, send mail, external send mail API, user registration, and verify code endpoints.

### IP Whitelist (Strict Mode)

When enabled, **only** whitelisted IPs can access protected endpoints; all others receive 403.

- Plain entries: exact match (no substring), e.g. `1.2.3.4`
- Regex entries: use anchored patterns, e.g. `^192\.168\.1\.\d+$`
- Whitelisted IPs skip blacklist checks
- If whitelist is enabled but the list is empty, the server ignores the switch (fail-open to prevent lockout)

### IP Blacklist

When enabled, matching IPs receive 403. Supports substring text matching or regex.

### ASN Organization Blacklist

Block by ISP/provider name, case-insensitive. Supports text or regex matching.

### Browser Fingerprint Blacklist

Block by `x-fingerprint` request header. Supports exact or regex matching.

### Daily Request Limit

Limit the maximum number of requests per IP per day (1–1,000,000). Exceeding the limit returns 429. Counter resets every 24 hours (UTC date boundary).
