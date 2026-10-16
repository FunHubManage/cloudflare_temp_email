import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';
import { buildBulkMailMessages, createBulkMailDraft } from '../utils/bulk-mail';

const DRAFT_KEY = 'adminBulkMailDraft';
const JOB_KEY = 'adminBulkMailJob';
// Route changes can create a new controller while the previous request is
// still settling. Coordinate those live instances without persisting a lock
// that could strand the batch after a full page refresh.
const storageRuntimes = new WeakMap();

export function useAdminBulkMail({ send, canSend, storage, intervalMs = 2000 }) {
    const storageError = ref('');
    try {
        storage ??= globalThis.sessionStorage;
    } catch (error) {
        storageError.value = error.message || 'Session storage is unavailable';
    }
    let runtime = storage && storageRuntimes.get(storage);
    if (!runtime) {
        runtime = { inFlight: null, lastCompletedAt: null };
        if (storage) storageRuntimes.set(storage, runtime);
    }

    function read(key) {
        try {
            const value = storage?.getItem(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            storageError.value = error.message || 'Unable to restore session';
            return null;
        }
    }

    const restoredDraft = read(DRAFT_KEY);
    const draft = ref(restoredDraft && Array.isArray(restoredDraft.recipients)
        && Array.isArray(restoredDraft.variables) ? { ...createBulkMailDraft(), ...restoredDraft } : createBulkMailDraft());
    const restoredJob = read(JOB_KEY);
    const job = ref(restoredJob && Array.isArray(restoredJob.items) ? restoredJob : null);
    const active = ref(false);
    const busy = computed(() => active.value);
    let disposed = false;
    let wakeDelay;
    let delayTimer;

    function persist(key, value) {
        try {
            if (!storage) throw new Error('Session storage is unavailable');
            storage.setItem(key, JSON.stringify(value));
            storageError.value = '';
            return true;
        } catch (error) {
            storageError.value = error.message || 'Unable to save session';
            if (job.value) {
                job.value.state = 'paused';
                job.value.reason = 'storage_error';
            }
            return false;
        }
    }

    function cancelDelay() {
        if (delayTimer !== undefined) clearTimeout(delayTimer);
        delayTimer = undefined;
        wakeDelay?.();
        wakeDelay = undefined;
    }

    function pause(reason = 'user_paused') {
        if (disposed || !job.value || job.value.state === 'completed') return;
        job.value.state = 'paused';
        job.value.reason = reason;
        cancelDelay();
        persist(JOB_KEY, job.value);
    }

    if (job.value) {
        for (const item of job.value.items) {
            if (item.status === 'sending') {
                item.status = 'unknown';
                item.error = 'interrupted';
            }
        }
        job.value.state = job.value.items.every(item => item.status === 'success') ? 'completed' : 'paused';
        job.value.reason = 'restored';
        persist(JOB_KEY, job.value);
    }

    const stopDraftWatch = watch(draft, value => {
        if (!persist(DRAFT_KEY, value)) cancelDelay();
    }, { deep: true, flush: 'sync' });

    function delay(milliseconds) {
        return new Promise(resolve => {
            wakeDelay = resolve;
            delayTimer = setTimeout(() => {
                delayTimer = undefined;
                wakeDelay = undefined;
                resolve();
            }, milliseconds);
        });
    }

    function waitForExistingRequest() {
        return new Promise(resolve => {
            wakeDelay = resolve;
            runtime.inFlight.then(() => {
                if (wakeDelay === resolve) wakeDelay = undefined;
                resolve();
            });
        });
    }

    async function run() {
        if (active.value) return;
        active.value = true;
        try {
            while (job.value?.state === 'running') {
                if (!canSend()) {
                    pause('access_changed');
                    break;
                }
                const item = job.value.items.find(value => value.status === 'pending');
                if (!item) {
                    job.value.state = 'completed';
                    job.value.reason = '';
                    persist(JOB_KEY, job.value);
                    break;
                }
                if (runtime.inFlight) {
                    await waitForExistingRequest();
                    continue;
                }
                const lastCompletedAt = Math.max(job.value.lastCompletedAt ?? -Infinity,
                    runtime.lastCompletedAt ?? -Infinity);
                const elapsed = Date.now() - lastCompletedAt;
                if (elapsed < intervalMs) {
                    await delay(intervalMs - elapsed);
                    continue;
                }
                item.status = 'sending';
                // This synchronous write must succeed before any request leaves
                // the browser, so a refreshed page never retries an active send.
                if (!persist(JOB_KEY, job.value)) {
                    item.status = 'pending';
                    break;
                }
                let settleRequest;
                runtime.inFlight = new Promise(resolve => { settleRequest = resolve; });
                try {
                    const response = await send({ ...item.payload });
                    if (disposed) return;
                    if (response?.status !== 'ok') throw new Error('Unexpected send response');
                    item.status = 'success';
                    item.error = '';
                } catch (error) {
                    if (disposed) return;
                    const status = error?.status ?? error?.response?.status;
                    item.status = [401, 403, 429].includes(Number(status)) ? 'failed' : 'unknown';
                    item.error = error?.message || String(error);
                    job.value.state = 'paused';
                    job.value.reason = 'send_error';
                } finally {
                    runtime.lastCompletedAt = Date.now();
                    runtime.inFlight = null;
                    settleRequest();
                }
                job.value.lastCompletedAt = Date.now();
                if (job.value.items.every(value => value.status === 'success')) {
                    job.value.state = 'completed';
                    job.value.reason = '';
                }
                if (!persist(JOB_KEY, job.value)) break;
            }
        } finally {
            active.value = false;
        }
    }

    function ensureStorage() {
        if (persist(DRAFT_KEY, draft.value) && persist(JOB_KEY, job.value)) return;
        const error = new Error(storageError.value);
        error.code = 'storage_error';
        throw error;
    }

    function start() {
        if (disposed || job.value || active.value) return false;
        const messages = buildBulkMailMessages(draft.value);
        if (!canSend()) return false;
        // Copy the full rendered batch before starting. Subsequent draft edits
        // cannot affect pending payloads in this job.
        job.value = {
            state: 'running', reason: '', lastCompletedAt: null,
            items: messages.map(message => ({ ...message, payload: Object.freeze({ ...message.payload }), status: 'pending', error: '' })),
        };
        ensureStorage();
        void run();
        return true;
    }

    function resume() {
        if (disposed || !job.value || active.value || job.value.state !== 'paused'
            || !job.value.items.some(item => item.status === 'pending') || !canSend()) return false;
        job.value.state = 'running';
        job.value.reason = '';
        ensureStorage();
        void run();
        return true;
    }

    function resetJob() {
        if (disposed || active.value) return false;
        const previous = job.value;
        job.value = null;
        if (!persist(JOB_KEY, null)) {
            job.value = previous;
            return false;
        }
        return true;
    }

    if (getCurrentScope()) onScopeDispose(() => {
        stopDraftWatch();
        pause('access_changed');
        // A remounted admin page can restore this session before its previous
        // in-flight request settles. The old instance must not overwrite it.
        disposed = true;
        cancelDelay();
    });

    return { draft, job, busy, start, pause, resume, resetJob, storageError };
}
