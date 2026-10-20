<template>
  <div class="custom-action-fields">
    <FieldRow
      group
      class="action-field"
      vertical
      density="compact"
      :label="t('settings.actionWebhookUrlLabel')"
      :warning="warningsOf('url')"
    >
      <div class="action-field-row">
        <SegmentedControl
          :model-value="webhook.method || 'POST'"
          :label="t('settings.actionWebhookMethod')"
          :options="[
            { id: 'POST', name: 'POST' },
            { id: 'GET', name: 'GET' },
          ]"
          @update:model-value="update('method', $event)"
        />
        <ActionTemplateField
          :model-value="webhook.url"
          placeholder="https://"
          :info="t('settings.actionWebhookUrlInfo', { placeholder: TEXT })"
          @update:model-value="update('url', $event)"
        />
      </div>
    </FieldRow>

    <FieldRow
      v-if="(webhook.method || 'POST') === 'POST'"
      class="action-field"
      vertical
      density="compact"
      :label="t('settings.actionWebhookBodyLabel')"
      :warning="warningsOf('payloadTemplate')"
    >
      <ActionTemplateField
        multiline
        :model-value="webhook.payloadTemplate"
        :placeholder="t('settings.actionWebhookPayloadPlaceholder')"
        :info="t('settings.actionWebhookBodyInfo', { placeholder: TEXT })"
        @update:model-value="update('payloadTemplate', $event)"
      />
    </FieldRow>

    <FieldRow
      class="action-field"
      vertical
      density="compact"
      :label="t('settings.actionWebhookHeadersLabel')"
    >
      <div
        v-for="(header, headerIndex) in headerRows"
        :key="headerIndex"
        class="action-field-row"
      >
        <FieldInput
          class="header-name"
          :aria-label="t('settings.actionWebhookHeaderName')"
          :model-value="header[0]"
          :placeholder="t('settings.actionWebhookHeaderName')"
          @update:model-value="updateHeader(headerIndex, 0, $event)"
        />
        <FieldInput
          class="flex-1"
          :aria-label="t('settings.actionWebhookHeaderValue')"
          :type="header[1].includes('tyco-secret:') ? 'password' : 'text'"
          :model-value="header[1].includes('tyco-secret:') ? '' : header[1]"
          :placeholder="
            header[1].includes('tyco-secret:')
              ? t('settings.actionWebhookAuthReplacePlaceholder')
              : t('settings.actionWebhookHeaderValue')
          "
          @update:model-value="updateHeader(headerIndex, 1, $event)"
        />
        <IconButton
          variant="ghost"
          size="sm"
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
    </FieldRow>

    <FieldRow
      class="action-field"
      vertical
      density="compact"
      :label="t('settings.actionWebhookAuthLabel')"
    >
      <div class="action-field-row">
        <FieldInput
          class="flex-1"
          type="password"
          :model-value="authDraft"
          :placeholder="
            hasAuth
              ? t('settings.actionWebhookAuthReplacePlaceholder')
              : t('settings.actionWebhookAuthPlaceholder')
          "
          @update:model-value="authDraft = $event"
        />
        <Button
          variant="primary"
          size="sm"
          :disabled="!authDraft.trim()"
          @click="saveAuth"
        >
          {{ t('common.save') }}
        </Button>
        <Button
          v-if="hasAuth"
          size="sm"
          variant="danger-ghost"
          @click="removeAuth"
        >
          {{ t('common.remove') }}
        </Button>
      </div>
      <p v-if="authBoundElsewhere" class="action-field-warning">
        {{ t('settings.apiKeyBoundTo', { origin: authOrigins.join(', ') }) }}
      </p>

      <template #info
        ><InfoTooltip :text="t('settings.actionWebhookAuthInfo')"
      /></template>
    </FieldRow>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { nextTick, onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { webhookToolConfig } from '../../lib/commands/command-config'
import { validateCommand } from '../../lib/commands/command-runtime'
import { createWebhookAuthModel } from '../../lib/commands/webhook-auth-model'
import { clientLogger } from '../../lib/logger'
import { httpOrigin } from '../../lib/net/secrets'
import { useSecretsStore } from '../../stores/secrets'
import { useSettingsSessionStore } from '../../stores/settings-session'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import ActionTemplateField from './ActionTemplateField.vue'
import type { CommandConfig } from '@tyco/shared'
import { ACTION_TEXT_PLACEHOLDER as TEXT } from '@tyco/shared'

const props = defineProps<{ command: CommandConfig }>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
const toolsStore = useToolsStore()
const issues = computed(() => validateCommand(props.command, toolsStore))
const warningsOf = (field: string) =>
  issues.value
    .filter((issue) => issue.field === field)
    .map((issue) => t(issue.messageKey, { placeholder: TEXT }))
function update(field: string, value: unknown) {
  emit('update', field, value)
}

const webhook = computed(() => webhookToolConfig(props.command))
const secretsStore = useSecretsStore()
const { toastKey, toastText } = useToast()
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

const session = useSettingsSessionStore()
const secretId = computed(() => webhook.value.authSecretId ?? '')
const hasAuth = computed(
  () =>
    props.command.toolId === 'webhook' &&
    Boolean(webhook.value.isAuthEnabled) &&
    Object.hasOwn(secretsStore.secrets, secretId.value)
)
const authOrigins = computed(
  () => secretsStore.secrets[secretId.value]?.origins ?? []
)
const authBoundElsewhere = computed(() => {
  if (!hasAuth.value) return false
  const origin = httpOrigin(webhook.value.url)
  return Boolean(origin) && !authOrigins.value.includes(origin!)
})

const { authDraft, saveAuth, removeAuth } = createWebhookAuthModel({
  getUrl: () => webhook.value.url,
  getSecretId: () => secretId.value,
  createId: () => crypto.randomUUID(),
  setSecret: secretsStore.setSecret,
  removeSecret: secretsStore.removeSecret,
  update,
  afterRender: nextTick,
  persist: session.persist,
  isSaved: session.isSaved,
  notifyInvalidOrigin: () => toastKey('settings.invalidBaseUrl', 'error'),
  reportError: (error) =>
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error'),
})

onMounted(() => {
  if (webhook.value.isAuthEnabled)
    void secretsStore
      .refreshSecrets()
      .catch((error: unknown) =>
        clientLogger.error(
          'Could not refresh webhook secrets',
          error,
          'webhook'
        )
      )
})
</script>
<style scoped>
.custom-action-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
  width: 100%;
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
