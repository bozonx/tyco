<template>
  <div class="custom-action-fields">
    <template v-if="command.toolId === 'script'">
      <div class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionCommandLabel') }}
          <InfoTooltip
            :text="t('settings.actionCommandInfo', { placeholder: TEXT })"
          />
        </span>
        <ActionTemplateField
          ref="commandRef"
          multiline
          :value="script.command"
          :placeholder="
            t('settings.actionCommandPlaceholder', { placeholder: TEXT })
          "
          @update:value="update('command', $event)"
        >
          <IconButton
            variant="ghost"
            size="sm"
            :title="t('settings.actionInsertScript')"
            @click="browseScript"
            :label="t('settings.actionInsertScript')"
            icon="mdi:file-code-outline"
          />
        </ActionTemplateField>
        <FieldIssues :issues="issuesOf('command')" />
      </div>

      <div class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionWorkingDirLabel') }}
          <InfoTooltip :text="t('settings.actionWorkingDirInfo')" />
        </span>
        <div class="action-field-row">
          <FieldInput
            class="flex-1"
            :value="script.workingDir"
            :placeholder="t('settings.actionWorkingDirPlaceholder')"
            @update:value="update('workingDir', $event)"
          />
          <IconButton
            variant="ghost"
            size="sm"
            :title="t('settings.browseWorkingDir')"
            @click="browseWorkingDir"
            :label="t('settings.browseWorkingDir')"
            icon="mdi:folder-open-outline"
          />
        </div>
      </div>
    </template>

    <template v-else-if="command.toolId === 'webhook'">
      <div class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionWebhookUrlLabel') }}
        </span>
        <div class="action-field-row">
          <SegmentedControl
            :value="webhook.method || 'POST'"
            :label="t('settings.actionWebhookMethod')"
            :options="[
              { id: 'POST', name: 'POST' },
              { id: 'GET', name: 'GET' },
            ]"
            @update:value="update('method', $event)"
          />
          <ActionTemplateField
            :value="webhook.url"
            placeholder="https://"
            :info="t('settings.actionWebhookUrlInfo', { placeholder: TEXT })"
            @update:value="update('url', $event)"
          />
        </div>
        <FieldIssues :issues="issuesOf('url')" />
      </div>

      <div v-if="(webhook.method || 'POST') === 'POST'" class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionWebhookBodyLabel') }}
        </span>
        <ActionTemplateField
          multiline
          :value="webhook.payloadTemplate"
          :placeholder="t('settings.actionWebhookPayloadPlaceholder')"
          :info="t('settings.actionWebhookBodyInfo', { placeholder: TEXT })"
          @update:value="update('payloadTemplate', $event)"
        />
        <FieldIssues :issues="issuesOf('payloadTemplate')" />
      </div>

      <div class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionWebhookHeadersLabel') }}
        </span>
        <div
          v-for="(header, headerIndex) in headerRows"
          :key="headerIndex"
          class="action-field-row"
        >
          <FieldInput
            class="header-name"
            :value="header[0]"
            :placeholder="t('settings.actionWebhookHeaderName')"
            @update:value="updateHeader(headerIndex, 0, $event)"
          />
          <FieldInput
            class="flex-1"
            :value="header[1]"
            :placeholder="t('settings.actionWebhookHeaderValue')"
            @update:value="updateHeader(headerIndex, 1, $event)"
          />
          <IconButton
            variant="ghost"
            size="sm"
            :title="t('common.remove')"
            @click="removeHeader(headerIndex)"
            :label="t('common.remove')"
            icon="mdi:close"
          />
        </div>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="mdi:plus"
            @click="addHeader"
          >
            {{ t('common.add') }}
          </Button>
        </div>
      </div>

      <div class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionWebhookAuthLabel') }}
          <InfoTooltip :text="t('settings.actionWebhookAuthInfo')" />
        </span>
        <div class="action-field-row">
          <FieldInput
            class="flex-1"
            type="password"
            :value="authDraft"
            :placeholder="
              hasAuth
                ? t('settings.actionWebhookAuthReplacePlaceholder')
                : t('settings.actionWebhookAuthPlaceholder')
            "
            @update:value="authDraft = $event"
          />
          <Button size="sm" :disabled="!authDraft.trim()" @click="saveAuth">
            {{ t('common.save') }}
          </Button>
          <Button
            v-if="hasAuth"
            size="sm"
            variant="ghost"
            class="danger-ghost"
            @click="removeAuth"
          >
            {{ t('common.remove') }}
          </Button>
        </div>
        <p v-if="authBoundElsewhere" class="action-field-warning">
          {{ t('settings.apiKeyBoundTo', { origin: authOrigins.join(', ') }) }}
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import {
  scriptToolConfig,
  webhookToolConfig,
} from '../../lib/commands/command-config'
import { validateCommand } from '../../lib/commands/command-runtime'
import { httpOrigin } from '../../lib/net/secrets'
import { useIpcStore } from '../../stores/ipc'
import { useLlmStore } from '../../stores/llm'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import ActionTemplateField from './ActionTemplateField.vue'
import FieldIssues from './FieldIssues.vue'
import {
  type CommandConfig,
  ACTION_TEXT_PLACEHOLDER as TEXT,
  webhookSecretId,
} from '@tyco/shared'

/** The settings of the `script` or `webhook` tool of a command */
const props = defineProps<{ command: CommandConfig }>()

const emit = defineEmits<{
  /** A field of the tool config changed */
  (event: 'update', field: string, value: unknown): void
}>()

const { t } = useI18n()
const { toast, toastText } = useToast()
const ipcStore = useIpcStore()
const llmStore = useLlmStore()
const toolsStore = useToolsStore()

const script = computed(() => scriptToolConfig(props.command))
const webhook = computed(() => webhookToolConfig(props.command))
const issues = computed(() => validateCommand(props.command, toolsStore))

const issuesOf = (field: string) =>
  issues.value.filter((issue) => issue.field === field)

const commandRef = ref<InstanceType<typeof ActionTemplateField> | null>(null)
const authDraft = ref('')

function update(field: string, value: unknown) {
  emit('update', field, value)
}

async function browseScript() {
  const res = await ipcStore.callFunctionOrNotify('pickScriptFile', [])
  if (typeof res.result === 'string') await commandRef.value?.insert(res.result)
}

async function browseWorkingDir() {
  const res = await ipcStore.callFunctionOrNotify('pickDirectory', [])
  if (typeof res.result === 'string') update('workingDir', res.result)
}

// headers are edited as rows: a row with an empty name is still shown
const headerRows = computed<[string, string][]>(() =>
  props.command.toolId === 'webhook'
    ? Object.entries(webhook.value.headers ?? {})
    : []
)

function setHeaders(rows: [string, string][]) {
  update('headers', Object.fromEntries(rows))
}

function updateHeader(index: number, part: 0 | 1, value: string) {
  const rows = headerRows.value.map((row) => [...row] as [string, string])
  rows[index][part] = value
  setHeaders(rows)
}

function addHeader() {
  if (headerRows.value.some(([name]) => !name)) return
  setHeaders([...headerRows.value, ['', '']])
}

function removeHeader(index: number) {
  setHeaders(headerRows.value.filter((_, i) => i !== index))
}

const secretId = computed(() => webhookSecretId(props.command.id))
const hasAuth = computed(
  () =>
    props.command.toolId === 'webhook' &&
    Boolean(webhook.value.authSecret) &&
    Object.hasOwn(llmStore.secrets, secretId.value)
)
const authOrigins = computed(
  () => llmStore.secrets[secretId.value]?.origins ?? []
)
const authBoundElsewhere = computed(() => {
  if (!hasAuth.value) return false
  const origin = httpOrigin(webhook.value.url)
  return Boolean(origin) && !authOrigins.value.includes(origin!)
})

async function saveAuth() {
  if (props.command.toolId !== 'webhook') return
  const value = authDraft.value.trim()
  const origin = httpOrigin(webhook.value.url)
  if (!value) return
  if (!origin) {
    toast('settings.invalidBaseUrl', 'error')
    return
  }
  try {
    await llmStore.setSecret(secretId.value, value, [origin])
    authDraft.value = ''
    update('authSecret', true)
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}

async function removeAuth() {
  try {
    await llmStore.removeSecret(secretId.value)
    update('authSecret', false)
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}

if (props.command.toolId === 'webhook' && webhook.value.authSecret) {
  llmStore.refreshSecrets().catch(() => {
    // the status only decides which placeholder is shown
  })
}
</script>

<style scoped>
.custom-action-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
  width: 100%;
}

.action-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 0.25rem);
}

.action-field-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  font-size: var(--text-caption);
  font-weight: 500;
  color: var(--app-text-muted);
}

.action-field-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
  width: 100%;
}

.action-field-warning {
  font-size: var(--text-caption);
  color: var(--color-warning);
}

.header-name {
  width: 10rem;
  flex: none;
}
</style>
