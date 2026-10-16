// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useAdminBulkMail } from '../use-admin-bulk-mail';

const controllers = [];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
let session;

function controller(options = {}) {
    const scope = effectScope();
    const send = options.send || vi.fn().mockResolvedValue({ status: 'ok' });
    const result = scope.run(() => useAdminBulkMail({ send, canSend: () => true, storage: session, ...options }));
    controllers.push(scope);
    if (!result.draft.value.fromMail) Object.assign(result.draft.value, {
        fromMail: 'sender@example.com', subject: 'Hi {{var1}}', content: 'Body', variables: ['var1'],
        recipients: [
            { id: 'a', email: 'a@example.com', values: { var1: 'Alice' } },
            { id: 'b', email: 'b@example.com', values: { var1: 'Bob' } },
            { id: 'c', email: 'c@example.com', values: { var1: 'Carol' } },
        ],
    });
    return { ...result, send, scope };
}

beforeEach(() => {
    sessionStorage.clear();
    session = { getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) };
    vi.useFakeTimers();
});
afterEach(() => { controllers.splice(0).forEach(scope => scope.stop()); vi.useRealTimers(); });

describe('admin bulk mail controller', () => {
    it('sends a frozen batch sequentially with a two-second gap after completion and rejects repeat starts', async () => {
        let finish;
        const send = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
            .mockResolvedValue({ status: 'ok' });
        const state = controller({ send });
        expect(state.start()).toBe(true);
        expect(state.start()).toBe(false);
        expect(state.resetJob()).toBe(false);
        expect(send).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5000);
        expect(send).toHaveBeenCalledTimes(1);
        state.draft.value.subject = 'Changed subject';
        finish({ status: 'ok' });
        await flush();
        await vi.advanceTimersByTimeAsync(1999);
        expect(send).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1][0]).toMatchObject({ subject: 'Hi Bob', to_mail: 'b@example.com' });
        await vi.advanceTimersByTimeAsync(2000);
        expect(send).toHaveBeenCalledTimes(3);
        expect(state.job.value.state).toBe('completed');
        expect(state.job.value.items.map(item => item.status)).toEqual(['success', 'success', 'success']);
        expect(state.busy.value).toBe(false);
    });

    it('pauses without aborting the active request, and resume cannot duplicate it', async () => {
        let finish;
        const state = controller({ send: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ status: 'ok' }) });
        state.start();
        state.pause();
        expect(state.busy.value).toBe(true);
        expect(state.resume()).toBe(false);
        finish({ status: 'ok' });
        await flush();
        expect(state.job.value.state).toBe('paused');
        expect(state.job.value.items[0].status).toBe('success');
        expect(state.busy.value).toBe(false);
        expect(state.resume()).toBe(true);
        await vi.advanceTimersByTimeAsync(1999);
        expect(state.send).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(state.send).toHaveBeenCalledTimes(2);
    });

    it.each([
        [Object.assign(new Error('forbidden'), { status: 403 }), 'failed'],
        [Object.assign(new Error('limited'), { status: 429 }), 'failed'],
        [Object.assign(new Error('server error'), { status: 500 }), 'unknown'],
        [Object.assign(new Error('rejected'), { status: 400 }), 'unknown'],
        [new Error('timeout'), 'unknown'],
    ])('stops on request errors without retrying attempted recipients', async (error, status) => {
        const state = controller({ send: vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ status: 'ok' }) });
        state.start();
        await flush();
        expect(state.job.value.state).toBe('paused');
        expect(state.job.value.items[0]).toMatchObject({ status, error: error.message });
        expect(state.send).toHaveBeenCalledTimes(1);
        state.resume();
        await vi.advanceTimersByTimeAsync(2000);
        expect(state.send).toHaveBeenCalledTimes(2);
        expect(state.send.mock.calls[1][0].to_mail).toBe('b@example.com');
    });

    it('requires an explicit success response', async () => {
        const state = controller({ send: vi.fn().mockResolvedValue({}) });
        state.start();
        await flush();
        expect(state.job.value.items[0].status).toBe('unknown');
        expect(state.job.value.state).toBe('paused');
    });

    it('stores sending before issuing a request and restores it as unknown without starting', async () => {
        let storedAtSend;
        const state = controller({ send: vi.fn(() => {
            storedAtSend = JSON.parse(sessionStorage.getItem('adminBulkMailJob'));
            return new Promise(() => {});
        }) });
        state.start();
        expect(storedAtSend.items[0].status).toBe('sending');
        const restored = controller();
        expect(restored.job.value.state).toBe('paused');
        expect(restored.job.value.items.map(item => item.status)).toEqual(['unknown', 'pending', 'pending']);
        expect(restored.send).not.toHaveBeenCalled();
    });

    it('preserves drafts in session storage and never auto-resumes pending jobs', async () => {
        const state = controller();
        state.start();
        await flush();
        state.pause();
        const restored = controller();
        expect(restored.draft.value.subject).toBe('Hi {{var1}}');
        expect(restored.job.value.state).toBe('paused');
        await vi.advanceTimersByTimeAsync(5000);
        expect(restored.send).not.toHaveBeenCalled();
    });

    it('waits for an old in-flight request after remount, then keeps its interval without overwriting restored results', async () => {
        let finish;
        const previous = controller({ send: vi.fn(() => new Promise(resolve => { finish = resolve; })) });
        previous.start();
        previous.scope.stop();
        const current = controller();
        expect(current.job.value.items[0].status).toBe('unknown');
        current.resume();
        await flush();
        await vi.advanceTimersByTimeAsync(5000);
        expect(current.send).not.toHaveBeenCalled();
        finish({ status: 'ok' });
        await flush();
        await vi.advanceTimersByTimeAsync(1999);
        expect(current.send).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(current.send.mock.calls[0][0].to_mail).toBe('b@example.com');
        expect(current.job.value.items[1].status).toBe('success');
        const stored = JSON.parse(sessionStorage.getItem('adminBulkMailJob'));
        expect(stored.items.map(item => item.status)).toEqual(['unknown', 'success', 'pending']);
        expect(previous.send).toHaveBeenCalledTimes(1);
    });

    it('allows pausing a remounted batch while waiting for an old live request', async () => {
        const previous = controller({ send: vi.fn(() => new Promise(() => {})) });
        previous.start();
        previous.scope.stop();
        const current = controller();
        current.resume();
        expect(current.busy.value).toBe(true);
        current.pause();
        await flush();
        expect(current.busy.value).toBe(false);
        expect(current.job.value.state).toBe('paused');
        expect(current.send).not.toHaveBeenCalled();
    });

    it('does not send when durable progress cannot be saved', () => {
        const storage = { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); } };
        const state = controller({ storage });
        expect(() => state.start()).toThrow('quota exceeded');
        expect(state.storageError.value).toBe('quota exceeded');
        expect(state.send).not.toHaveBeenCalled();
        expect(state.job.value.state).toBe('paused');
    });

    it('stops before the next request when progress persistence fails after a response', async () => {
        const store = new Map();
        let writes = 0;
        const storage = {
            getItem: key => store.get(key),
            setItem: (key, value) => {
                if (key === 'adminBulkMailJob' && ++writes === 3) throw new Error('disk full');
                store.set(key, value);
            },
        };
        const state = controller({ storage });
        state.start();
        await flush();
        expect(state.job.value.state).toBe('paused');
        await vi.advanceTimersByTimeAsync(5000);
        expect(state.send).toHaveBeenCalledTimes(1);
    });

    it('checks access before each request', async () => {
        let allowed = true;
        const state = controller({ canSend: () => allowed });
        state.start();
        await flush();
        allowed = false;
        await vi.advanceTimersByTimeAsync(2000);
        expect(state.send).toHaveBeenCalledTimes(1);
        expect(state.job.value).toMatchObject({ state: 'paused', reason: 'access_changed' });
    });

    it('validates the entire batch before making any request', () => {
        const state = controller();
        state.draft.value.recipients[1].values.var1 = '';
        expect(() => state.start()).toThrow('missing_variable');
        expect(state.job.value).toBeNull();
        expect(state.send).not.toHaveBeenCalled();
    });
});
