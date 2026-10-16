<script setup>
import '@wangeditor/editor/dist/css/style.css'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { AddRound, CloseRound, KeyboardArrowDownRound, PauseRound, PlayArrowRound, SendRound } from '@vicons/material'
import { useScopedI18n } from '@/i18n/app'
import ShadowHtmlComponent from '../../components/ShadowHtmlComponent.vue'
import { useGlobalState } from '../../store'
import { nextBulkMailVariable, parseRecipientEmails, renderBulkMailMessage } from '../../utils/bulk-mail'
import { blockRemoteContent } from '../../utils/remote-content-policy'
import { sanitizeHtml } from '../../utils/sanitize-html'

const props = defineProps({ controller: { type: Object, required: true } })
const { draft, job, busy, storageError } = props.controller
const { t } = useScopedI18n('views.admin.BulkMail')
const { autoLoadRemoteImages, isDark } = useGlobalState()
const message = useMessage()
const pageRef = ref()
const showRecipientModal = ref(false)
const pasteText = ref('')
const pasteFeedback = ref(null)
const validationError = ref(null)
const selectedRecipientId = ref(null)
const editorRef = shallowRef()
const locked = computed(() => Boolean(job.value))
const running = computed(() => job.value?.state === 'running')
const items = computed(() => job.value?.items ?? [])
const pendingCount = computed(() => items.value.filter(item => item.status === 'pending').length)
const successCount = computed(() => items.value.filter(item => item.status === 'success').length)
const resolvedCount = computed(() => items.value.filter(item => ['success', 'failed', 'unknown'].includes(item.status)).length)
const progress = computed(() => items.value.length ? Math.round(resolvedCount.value / items.value.length * 100) : 0)
const previewRows = computed(() => job.value ? items.value : draft.value.recipients)
const previewOptions = computed(() => previewRows.value.map((row, index) => ({
    label: row.email || t('recipientNumber', { count: index + 1 }), value: row.id,
})))
const contentTypes = computed(() => [
    { label: t('text'), value: 'text' },
    { label: t('html'), value: 'html' },
    { label: t('rich'), value: 'rich' },
])

watch(previewRows, (rows) => {
    if (!rows.some(row => row.id === selectedRecipientId.value)) {
        selectedRecipientId.value = rows[0]?.id ?? null
    }
}, { deep: true, immediate: true })

watch(locked, (value) => {
    if (value) editorRef.value?.disable()
    else editorRef.value?.enable()
})

watch(draft, () => { validationError.value = null }, { deep: true })

const validationKeys = {
    recipients_required: 'recipientsRequired', recipients_limit: 'recipientsLimit',
    invalid_email: 'invalidEmail', duplicate_email: 'duplicateEmail',
    from_required: 'fromRequired', subject_required: 'subjectRequired',
    content_required: 'contentRequired', unknown_variable: 'unknownVariable',
    missing_variable: 'missingVariable', invalid_variable_context: 'invalidVariableContext',
    storage_error: 'storageError',
}

const errorText = (error) => t(validationKeys[error?.code] ?? 'validationFailed', {
    variable: error?.variable ?? '',
    recipient: draft.value.recipients.find(row => row.id === error?.recipientId)?.email ?? '',
})

const preview = computed(() => {
    const row = previewRows.value.find(row => row.id === selectedRecipientId.value)
    if (!row) return null
    if (job.value) return { payload: row.payload }
    try {
        return { payload: renderBulkMailMessage(draft.value, row).payload }
    } catch (error) {
        return { error: errorText(error) }
    }
})

const previewContent = computed(() => {
    const content = `${preview.value?.payload?.content ?? ''}`
    return autoLoadRemoteImages.value ? sanitizeHtml(content) : blockRemoteContent(content).html
})

const newRecipient = (email = '') => ({
    id: crypto.randomUUID(), email,
    values: Object.fromEntries(draft.value.variables.map(variable => [variable, ''])),
})

const addRecipient = () => {
    if (locked.value || draft.value.recipients.length >= 100) return
    draft.value.recipients.push(newRecipient())
}

const addPastedRecipients = () => {
    if (locked.value) return
    const parsed = parseRecipientEmails(pasteText.value, draft.value.recipients.map(row => row.email))
    if (draft.value.recipients.length + parsed.emails.length > 100) {
        pasteFeedback.value = { ...parsed, overLimit: true }
        return
    }
    draft.value.recipients.push(...parsed.emails.map(newRecipient))
    pasteText.value = parsed.invalid.join('\n')
    pasteFeedback.value = parsed
    if (!parsed.invalid.length) showRecipientModal.value = false
}

const recipientMenuOptions = computed(() => [{
    label: t('bulkAddRecipients'), key: 'multiple',
    disabled: locked.value || draft.value.recipients.length >= 100,
}])
const openRecipientModal = () => {
    if (locked.value || draft.value.recipients.length >= 100) return
    pasteFeedback.value = null
    showRecipientModal.value = true
}

const addVariable = () => {
    if (locked.value) return
    const variable = nextBulkMailVariable(draft.value.variables)
    draft.value.variables.push(variable)
    draft.value.recipients.forEach(row => { row.values[variable] = '' })
}

const removeVariable = (variable) => {
    if (locked.value) return
    draft.value.variables = draft.value.variables.filter(value => value !== variable)
    draft.value.recipients.forEach(row => { delete row.values[variable] })
}

const removeRecipient = (id) => {
    if (locked.value) return
    draft.value.recipients = draft.value.recipients.filter(row => row.id !== id)
}

const startBatch = async () => {
    validationError.value = null
    try {
        await props.controller.start()
    } catch (error) {
        validationError.value = error
        await nextTick()
        const row = error.recipientId
            ? [...(pageRef.value?.querySelectorAll('[data-recipient-id]') ?? [])]
                .find(element => element.dataset.recipientId === error.recipientId)
            : null
        const field = { fromMail: 'bulk-mail-from', from_mail: 'bulk-mail-from', subject: 'bulk-mail-subject', content: 'bulk-mail-content-panel' }[error.field]
        const target = row ?? (field ? document.getElementById(field) : null)
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const variableCell = row && error.variable
            ? [...row.querySelectorAll('[data-variable]')].find(element => element.dataset.variable === error.variable)
            : null
        const focusTarget = variableCell ?? target
        focusTarget?.querySelector('input,textarea,[contenteditable="true"]')?.focus()
        if (target?.matches('input,textarea')) target.focus()
    }
}

const resumeBatch = async () => {
    try {
        await props.controller.resume()
    } catch (error) {
        validationError.value = error
    }
}

const resetBatch = () => {
    props.controller.resetJob()
    validationError.value = null
}

const statusKeys = { pending: 'statusPending', sending: 'statusSending', success: 'statusSuccess', failed: 'statusFailed', unknown: 'statusUnknown' }
const statusTypes = { pending: 'default', sending: 'info', success: 'success', failed: 'error', unknown: 'warning' }
const resultError = (item) => {
    if (item.error === 'interrupted') return t('interruptedRequest')
    if (item.error === 'Unexpected send response') return t('unconfirmedResponse')
    return item.error || '—'
}
const stateKeys = { running: 'stateRunning', paused: 'statePaused', completed: 'stateCompleted' }
const pauseReason = computed(() => {
    const keys = { user_paused: 'pauseUser', restored: 'pauseRestored', access_changed: 'pauseAccess', send_error: 'pauseError', storage_error: 'storageError', leaving_admin: 'pauseLeftAdmin' }
    return t(keys[job.value?.reason] ?? 'pauseUser')
})

const toolbarConfig = { excludeKeys: ['uploadVideo'] }
const editorConfig = {
    MENU_CONF: {
        uploadImage: {
            async customUpload() { message.error(t('imageTooLarge')) },
            maxFileSize: 1024 * 1024,
            base64LimitSize: 1024 * 1024,
        },
    },
}
const handleCreated = (editor) => {
    editorRef.value = editor
    if (locked.value) editor.disable()
}
onBeforeUnmount(() => editorRef.value?.destroy())
</script>

<template>
    <div ref="pageRef" class="bulk-mail-page">
        <n-card :bordered="false" embedded class="bulk-mail-card">
            <template #header>
                <div class="bulk-heading">
                    <h2>{{ t('title') }}</h2>
                    <n-tag size="small" :bordered="false">{{ t('adminOnly') }}</n-tag>
                </div>
            </template>

            <n-alert type="info" :show-icon="false" class="bulk-notice">{{ t('sendTip') }}</n-alert>
            <n-alert v-if="storageError" type="error" class="bulk-notice">{{ t('storageError') }}</n-alert>
            <n-alert v-if="validationError" type="error" class="bulk-notice" role="alert">
                {{ errorText(validationError) }}
            </n-alert>

            <div class="bulk-compose-layout">
            <n-form class="bulk-compose-form" :model="draft" label-placement="top" :disabled="locked" @submit.prevent>
                <n-grid cols="1 m:2" responsive="screen" :x-gap="16">
                    <n-grid-item>
                        <n-form-item :label="t('senderAddress')" required :label-props="{ for: 'bulk-mail-from' }">
                            <n-input v-model:value="draft.fromMail" :input-props="{ id: 'bulk-mail-from' }" />
                        </n-form-item>
                    </n-grid-item>
                    <n-grid-item>
                        <n-form-item :label="t('senderName')" :label-props="{ for: 'bulk-mail-from-name' }">
                            <n-input v-model:value="draft.fromName" :input-props="{ id: 'bulk-mail-from-name' }" />
                        </n-form-item>
                    </n-grid-item>
                </n-grid>

                <section class="recipient-panel" :aria-label="t('recipients')">
                    <div class="section-heading">
                        <h3>{{ t('recipients') }} <n-text depth="3">{{ draft.recipients.length }} / 100</n-text></h3>
                    </div>
                    <div class="recipient-sheet">
                        <div class="table-scroll">
                            <n-table size="small" :single-line="false" class="recipient-table">
                                <thead><tr>
                                    <th class="row-number">#</th>
                                    <th class="email-column">{{ t('email') }}</th>
                                    <th v-for="variable in draft.variables" :key="variable" class="variable-column">
                                        <div class="variable-column-heading">
                                            <span v-text="`{{${variable}}}`" />
                                            <n-button v-if="!locked" text size="tiny" class="remove-variable"
                                                :aria-label="t('closeVariable', { variable })" @click="removeVariable(variable)">
                                                <n-icon :component="CloseRound" />
                                            </n-button>
                                        </div>
                                    </th>
                                    <th class="table-controls-column">
                                        <n-button v-if="!locked" quaternary size="small" class="add-column"
                                            :aria-label="t('addVariable')" :title="t('addVariable')" @click="addVariable">
                                            <template #icon><n-icon :component="AddRound" /></template>
                                        </n-button>
                                    </th>
                                </tr></thead>
                                <tbody><tr v-for="(row, index) in draft.recipients" :key="row.id" :data-recipient-id="row.id"
                                    :class="{ 'invalid-row': validationError?.recipientId === row.id }">
                                    <td>{{ index + 1 }}</td>
                                    <td><n-input v-model:value="row.email" size="small" :status="validationError?.recipientId === row.id ? 'error' : undefined"
                                        :input-props="{ 'aria-label': t('recipientEmailLabel', { count: index + 1 }) }" /></td>
                                    <td v-for="variable in draft.variables" :key="variable" :data-variable="variable">
                                        <n-input v-model:value="row.values[variable]" size="small"
                                            :status="validationError?.recipientId === row.id && validationError?.variable === variable ? 'error' : undefined"
                                            :input-props="{ 'aria-label': t('variableValueLabel', { count: index + 1, variable }) }" />
                                    </td>
                                    <td class="table-controls-column"><n-button v-if="!locked" size="small" quaternary type="error"
                                        :aria-label="t('remove')" @click="removeRecipient(row.id)"><n-icon :component="CloseRound" /></n-button></td>
                                </tr></tbody>
                            </n-table>
                        </div>
                        <n-empty v-if="!draft.recipients.length" :description="t('noRecipients')" class="recipients-empty" />
                        <div v-if="!locked" class="recipient-sheet-footer">
                            <n-button-group class="add-row-controls">
                                <n-button size="small" :disabled="draft.recipients.length >= 100" @click="addRecipient">
                                    <template #icon><n-icon :component="AddRound" /></template>{{ t('addRecipient') }}
                                </n-button>
                                <n-dropdown trigger="click" :options="recipientMenuOptions" @select="openRecipientModal">
                                    <n-button size="small" :disabled="draft.recipients.length >= 100" class="add-row-menu"
                                        :aria-label="t('addRecipientOptions')" aria-haspopup="menu">
                                        <n-icon :component="KeyboardArrowDownRound" />
                                    </n-button>
                                </n-dropdown>
                            </n-button-group>
                        </div>
                    </div>
                    <n-text v-if="pasteFeedback?.duplicates.length" depth="3" class="import-feedback">
                        {{ t('duplicatesSkipped', { count: pasteFeedback.duplicates.length }) }}
                    </n-text>
                    <n-text depth="3" class="variable-tip">{{ t('variableTip') }}</n-text>
                </section>

                <n-form-item :label="t('subject')" required :label-props="{ for: 'bulk-mail-subject' }">
                    <n-input v-model:value="draft.subject" :input-props="{ id: 'bulk-mail-subject' }" />
                </n-form-item>
                <div id="bulk-mail-content-panel" class="editor-panel" :class="{ 'editor-dark': isDark }"
                    role="group" aria-labelledby="bulk-mail-content-label">
                    <div class="section-heading editor-heading">
                        <n-text id="bulk-mail-content-label" strong>{{ t('content') }} <span class="required-mark">*</span></n-text>
                        <n-radio-group v-model:value="draft.contentType" :disabled="locked" size="small" aria-labelledby="bulk-mail-content-label">
                            <n-radio-button v-for="option in contentTypes" :key="option.value" :value="option.value" :label="option.label" />
                        </n-radio-group>
                    </div>
                    <div v-if="draft.contentType === 'rich'" class="rich-editor">
                        <Toolbar :defaultConfig="toolbarConfig" :editor="editorRef" mode="default" />
                        <Editor v-model="draft.content" :defaultConfig="editorConfig" mode="default" @onCreated="handleCreated" />
                    </div>
                    <n-input v-else v-model:value="draft.content" type="textarea" :bordered="false" :disabled="locked"
                        :placeholder="t('contentPlaceholder')" :input-props="{ id: 'bulk-mail-content', 'aria-label': t('content') }"
                        :autosize="{ minRows: 10, maxRows: 24 }" />
                </div>
            </n-form>

            <section class="preview-panel" :aria-label="t('personalizedPreview')">
                <div class="section-heading">
                    <h3>{{ t('personalizedPreview') }}</h3>
                    <n-select v-model:value="selectedRecipientId" class="preview-select" :options="previewOptions"
                        :placeholder="t('selectRecipient')" :disabled="!previewOptions.length" filterable :aria-label="t('selectRecipient')" />
                </div>
                <n-alert v-if="preview?.error" type="warning" :show-icon="false">{{ preview.error }}</n-alert>
                <template v-else-if="preview?.payload">
                    <div class="preview-subject"><n-text depth="3">{{ t('subject') }}</n-text><strong>{{ preview.payload.subject }}</strong></div>
                    <div v-if="preview.payload.is_html" class="html-preview"><ShadowHtmlComponent :htmlContent="previewContent" :isDark="isDark" /></div>
                    <pre v-else class="text-preview">{{ preview.payload.content }}</pre>
                </template>
                <n-text v-else depth="3">{{ t('previewEmpty') }}</n-text>
            </section>
            </div>

            <section v-if="job" class="results-panel" :aria-label="t('results')" aria-live="polite">
                <div class="section-heading"><h3>{{ t('results') }}</h3><n-tag :type="running ? 'info' : job.state === 'completed' ? 'success' : 'warning'">{{ t(stateKeys[job.state]) }}</n-tag></div>
                <n-text>{{ t('progress', { done: resolvedCount, total: items.length, success: successCount }) }}</n-text>
                <n-progress type="line" :percentage="progress" :show-indicator="false" class="batch-progress" />
                <n-alert v-if="job.state === 'paused'" type="warning" class="bulk-notice" :show-icon="false">{{ pauseReason }}</n-alert>
                <n-text depth="3" class="results-tip">{{ t('acceptedTip') }}</n-text>
                <div class="table-scroll">
                    <n-table size="small" :single-line="false" class="results-table">
                        <thead><tr><th>{{ t('email') }}</th><th>{{ t('status') }}</th><th>{{ t('details') }}</th></tr></thead>
                        <tbody><tr v-for="item in items" :key="item.id">
                            <td>{{ item.email }}</td>
                            <td><n-tag size="small" :type="statusTypes[item.status]">{{ t(statusKeys[item.status]) }}</n-tag></td>
                            <td>{{ resultError(item) }}</td>
                        </tr></tbody>
                    </n-table>
                </div>
            </section>

            <div class="batch-actions">
                <n-text depth="3" class="session-tip">{{ locked ? t('snapshotTip') : t('sessionTip') }}</n-text>
                <div class="inline-actions">
                    <n-button v-if="!job" type="primary" :loading="busy" :disabled="busy || !draft.recipients.length || Boolean(storageError)" @click="startBatch">
                        <template #icon><n-icon :component="SendRound" /></template>{{ t('start', { count: draft.recipients.length }) }}
                    </n-button>
                    <n-button v-if="running" type="warning" @click="props.controller.pause()">
                        <template #icon><n-icon :component="PauseRound" /></template>{{ t('pause') }}
                    </n-button>
                    <n-button v-else-if="job && pendingCount" type="primary" :loading="busy" :disabled="busy || Boolean(storageError)" @click="resumeBatch">
                        <template #icon><n-icon :component="PlayArrowRound" /></template>{{ t('resume', { count: pendingCount }) }}
                    </n-button>
                    <n-popconfirm v-if="job" @positive-click="resetBatch" :positive-text="t('newBatch')" :negative-text="t('cancel')">
                        <template #trigger><n-button :disabled="running || busy">{{ t('newBatch') }}</n-button></template>
                        <span class="new-batch-confirm">{{ t('newBatchConfirm') }}</span>
                    </n-popconfirm>
                </div>
            </div>
        </n-card>
        <n-modal v-model:show="showRecipientModal" preset="card" class="recipient-import-modal"
            :title="t('bulkAddTitle')" :aria-label="t('bulkAddTitle')" role="dialog" aria-modal="true"
            style="width: min(560px, calc(100vw - 32px));" :bordered="false">
            <n-text depth="3" class="import-dialog-tip">{{ t('bulkAddTip') }}</n-text>
            <n-input v-model:value="pasteText" type="textarea" :autosize="{ minRows: 8, maxRows: 14 }"
                :placeholder="t('pastePlaceholder')" :input-props="{ 'aria-label': t('pasteAddresses') }" />
            <n-alert v-if="pasteFeedback?.overLimit" type="error" class="import-dialog-feedback">{{ t('recipientsLimit') }}</n-alert>
            <n-alert v-if="pasteFeedback?.invalid.length" type="warning" class="import-dialog-feedback" role="alert">
                {{ t('invalidAddresses', { addresses: pasteFeedback.invalid.join(', ') }) }}
            </n-alert>
            <template #footer>
                <div class="import-dialog-actions">
                    <n-button @click="showRecipientModal = false">{{ t('cancel') }}</n-button>
                    <n-button type="primary" :disabled="locked || !pasteText.trim()" @click="addPastedRecipients">{{ t('addAddresses') }}</n-button>
                </div>
            </template>
        </n-modal>
    </div>
</template>

<style scoped>
.bulk-mail-page { width: 100%; min-width: 0; padding: 14px 0 24px; text-align: left; }
.bulk-mail-card { width: min(1680px, 100%); min-width: 0; margin: 0 auto; }
.bulk-heading, .section-heading, .inline-actions, .batch-actions { display: flex; align-items: center; gap: 12px; }
.bulk-heading h2 { margin: 0; font-size: 18px; font-weight: 600; }
.section-heading { justify-content: space-between; flex-wrap: wrap; margin-bottom: 12px; }
.section-heading h3 { margin: 0; font-size: 15px; font-weight: 600; }
.section-heading h3 .n-text { margin-left: 6px; font-size: 13px; font-weight: 400; }
.inline-actions { flex-wrap: wrap; }
.bulk-notice { margin-bottom: 16px; overflow-wrap: anywhere; }
.bulk-compose-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); align-items: stretch; gap: 24px; }
.bulk-compose-form { min-width: 0; }
.recipient-panel { margin: 4px 0 24px; }
.recipient-sheet { min-width: 0; border: 1px solid rgba(128, 128, 128, .2); border-radius: 5px; overflow: hidden; }
.recipient-sheet-footer { display: flex; align-items: center; padding: 10px 12px; border-top: 1px solid rgba(128, 128, 128, .16); }
.add-row-menu { padding-right: 8px; padding-left: 8px; }
.variable-column-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.remove-variable { color: #888; }
.table-controls-column { position: sticky; right: 0; width: 40px; min-width: 40px; text-align: center; }
.recipient-table :deep(th.table-controls-column) { z-index: 2; }
.recipient-table :deep(td.table-controls-column) { background: var(--n-td-color); }
.recipient-table .add-column { padding: 0; width: 28px; }
.import-dialog-tip { display: block; margin-bottom: 14px; }
.import-dialog-feedback { margin-top: 14px; overflow-wrap: anywhere; }
.import-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
.variable-tip, .import-feedback, .results-tip { display: block; margin: 8px 0 12px; font-size: 13px; }
.table-scroll { width: 100%; max-width: 100%; overflow-x: auto; }
.recipient-table { width: 100%; min-width: 340px; border: 0; border-radius: 0; overflow: visible; }
.recipient-table .row-number { width: 34px; }
.recipient-table .email-column { min-width: 230px; }
.recipient-table .variable-column { min-width: 150px; }
.invalid-row { outline: 1px solid #d03050; outline-offset: -1px; }
.recipients-empty { padding: 24px 12px; }
.editor-panel { overflow: hidden; border: 1px solid rgba(128, 128, 128, .24); border-radius: 3px; }
.editor-heading { padding: 8px 12px; margin: 0; border-bottom: 1px solid rgba(128, 128, 128, .18); }
.required-mark { color: #d03050; }
.rich-editor { background: #fff; }
.rich-editor :deep(.w-e-toolbar) { border-bottom: 1px solid #e5e7eb; }
.rich-editor :deep(.w-e-text-container), .rich-editor :deep(.w-e-scroll) { min-height: 300px; }
.editor-dark .rich-editor { --w-e-textarea-bg-color: #25252a; --w-e-textarea-color: #ddd; --w-e-toolbar-bg-color: #25252a; --w-e-toolbar-color: #bbb; --w-e-toolbar-active-color: #eee; --w-e-toolbar-active-bg-color: #444; --w-e-toolbar-disabled-color: #666; --w-e-toolbar-border-color: #444; --w-e-modal-button-bg-color: #333; --w-e-modal-button-border-color: #555; }
.editor-dark .rich-editor :deep(.w-e-toolbar) { border-color: #444; }
.results-panel { margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(128, 128, 128, .18); }
/* Let the form determine the row height, then scroll the preview within it. */
.preview-panel { display: flex; flex-direction: column; justify-self: end; box-sizing: border-box; width: min(900px, 100%); min-width: 0; min-height: 0; contain: size; overflow: hidden; padding: 18px; border: 1px solid rgba(128, 128, 128, .18); border-radius: 5px; }
.preview-panel > .section-heading { align-items: stretch; flex-shrink: 0; gap: 16px; }
.preview-select { width: 100%; }
.preview-subject { display: flex; flex-direction: column; flex-shrink: 0; gap: 6px; overflow-wrap: anywhere; padding: 4px 0 16px; }
.preview-subject strong { font-weight: 500; }
.html-preview, .text-preview { flex: 1; min-height: 0; padding: 16px; margin: 0; border: 1px solid rgba(128, 128, 128, .18); border-radius: 3px; overflow: auto; }
.text-preview { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.7; }
.batch-progress { margin: 10px 0 16px; }
.results-table { min-width: 520px; }
.results-table td:first-child { min-width: 180px; overflow-wrap: anywhere; }
.results-table td:last-child { max-width: 480px; overflow-wrap: anywhere; }
.batch-actions { justify-content: space-between; flex-wrap: wrap; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(128, 128, 128, .18); }
.session-tip { max-width: 620px; font-size: 13px; }
.new-batch-confirm { display: inline-block; max-width: 300px; }
@media (max-width: 900px) {
    .bulk-compose-layout { grid-template-columns: minmax(0, 1fr); }
    .preview-panel { contain: none; }
    .html-preview, .text-preview { flex: none; min-height: 260px; max-height: min(640px, calc(100vh - 250px)); }
}
@media (max-width: 640px) {
    .bulk-mail-page { padding-top: 8px; }
    .bulk-mail-card :deep(.n-card__content) { padding-right: 12px; padding-left: 12px; }
    .preview-panel { padding: 14px; }
    .preview-select { width: 100%; }
    .batch-actions > .inline-actions { width: 100%; justify-content: flex-end; }
    .rich-editor :deep(.w-e-toolbar) { overflow-x: auto; }
}
</style>
