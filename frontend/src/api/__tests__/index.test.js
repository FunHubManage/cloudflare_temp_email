// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, request } = vi.hoisted(() => ({
    state: Object.fromEntries([
        'loading', 'auth', 'jwt', 'settings', 'openSettings', 'userOpenSettings',
        'userSettings', 'announcement', 'showAuth', 'adminAuth', 'showAdminAuth', 'userJwt',
    ].map(key => [key, { value: key === 'userSettings' ? {} : '' }])),
    request: vi.fn(),
}));
vi.mock('../../store', () => ({ useGlobalState: () => state }));
vi.mock('axios', () => ({ default: { create: () => ({ request }) } }));
vi.mock('../../i18n', () => ({ default: { global: { locale: { value: 'en' } } } }));
vi.mock('../../utils/fingerprint', () => ({ getFingerprint: async () => 'test-fingerprint' }));
vi.mock('../user-access-token-interceptor', () => ({
    createUserAccessTokenInterceptor: () => ({ matches: () => false }),
}));

import { api } from '../index';

describe('API error metadata', () => {
    beforeEach(() => {
        request.mockReset();
        state.showAdminAuth.value = false;
        state.showAuth.value = false;
        state.loading.value = false;
    });

    it('preserves the existing message and adds the HTTP response details', async () => {
        const data = { message: 'Provider rejected request', code: 'SEND_FAILED' };
        request.mockResolvedValue({ status: 400, data });
        await expect(api.fetch('/admin/send_mail')).rejects.toMatchObject({
            message: '[400]: Provider rejected request', status: 400, code: 'SEND_FAILED', data,
        });
        expect(state.loading.value).toBe(false);
    });

    it('preserves metadata for rejected Axios HTTP responses', async () => {
        const data = { message: 'Service unavailable' };
        request.mockRejectedValue({ code: 'ERR_BAD_RESPONSE', response: { status: 503, data } });
        await expect(api.fetch('/admin/send_mail')).rejects.toMatchObject({
            message: 'Code 503: Service unavailable', status: 503, code: 'ERR_BAD_RESPONSE', data,
        });
    });

    it('keeps ambiguous network failures unchanged without retrying', async () => {
        const error = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
        request.mockRejectedValue(error);
        await expect(api.fetch('/admin/send_mail', { showLoading: false })).rejects.toBe(error);
        expect(request).toHaveBeenCalledTimes(1);
        expect(state.loading.value).toBe(false);
    });

    it.each([
        ['AUTH_ADMIN_CREDENTIAL_INVALID', 'showAdminAuth'],
        ['AUTH_SITE_PASSWORD_INVALID', 'showAuth'],
    ])('retains the %s authentication prompt', async (code, flag) => {
        request.mockResolvedValue({ status: 401, data: { code, message: 'Unauthorized' } });
        await expect(api.fetch('/admin/send_mail')).rejects.toMatchObject({ status: 401, code });
        expect(state[flag].value).toBe(true);
    });

    it('returns successful responses unchanged', async () => {
        request.mockResolvedValue({ status: 200, data: { status: 'ok' } });
        await expect(api.fetch('/admin/send_mail')).resolves.toEqual({ status: 'ok' });
    });
});
