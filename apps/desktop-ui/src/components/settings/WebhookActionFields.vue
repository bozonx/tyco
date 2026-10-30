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
        <template v-if="secretIdOf(header[1])">
          <FieldInput
            class="flex-1"
            type="password"
            :aria-label="t('settings.actionWebhookHeaderValue')"
            :model-value="secretDrafts[headerIndex] ?? ''"
            :placeholder="t('settings.actionWebhookAuthReplacePlaceholder')"
            @update:model-value="secretDrafts[headerIndex] = $event"
          />
          <Button
            variant="primary"
            size="sm"
            :disabled="!secretDrafts[headerIndex]?.trim()"
            @click="replaceHeaderSecret(headerIndex)"
          >
            {{ t('common.save') }}
          </Button>
        </template>
        <FieldInput
          v-else
          class="flex-1"
          :aria-label="t('settings.actionWebhookHeaderValue')"
          :model-value="header[1]"
          :placeholder="t('settings.actionWebhookHeaderValue')"
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
      <p v-if="duplicateHeaders.size" class="action-field-warning">
        {{ t('settings.actionWebhookHeaderDuplicate') }}
      </p>
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
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'

import { useCommandValidation } from '../../composables/use-command-validation'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { webhookToolConfig } from '../../lib/commands/command-config'
import { createWebhookAuthModel } from '../../lib/commands/webhook-auth-model'
import {
  type WebhookHeaderRow,
  addWebhookHeaderRow,
  duplicateWebhookHeaderRows,
  isSameWebhookHeaders,
  removeWebhookHeaderRow,
  updateWebhookHeaderRow,
  webhookHeaderRows,
  webhookHeadersFromRows,
} from '../../lib/commands/webhook-header-rows'
import { clientLogger } from '../../lib/logger'
import { httpOrigin, secretIdFromRef } from '../../lib/net/secrets'
import { useSecretsStore } from '../../stores/secrets'
import { useSettingsSessionStore } from '../../stores/settings-session'
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
const warningsOf = useCommandValidation(() => props.command)
function update(field: string, value: unknown) {
  emit('update', field, value)
}

const webhook = computed(() => webhookToolConfig(props.command))
const secretsStore = useSecretsStore()
const { toastKey, toastError } = useToast()
// the rows live here, so a row without a name or with a repeated one is kept
// while it is edited; the config gets the valid headers only
const headerRows = ref<WebhookHeaderRow[]>([])
const secretDrafts = reactive<Record<number, string>>({})
const configHeaders = computed(() =>
  props.command.toolId === 'webhook' ? (webhook.value.headers ?? {}) : {}
)
watch(
  [() => props.command.id, configHeaders],
  ([id], [previousId]) => {
    if (
      id === previousId &&
      isSameWebhookHeaders(
        webhookHeadersFromRows(headerRows.value),
        configHeaders.value
      )
    )
      return
    headerRows.value = webhookHeaderRows(configHeaders.value)
    for (const key of Object.keys(secretDrafts)) delete secretDrafts[+key]
  },
  { immediate: true }
)
const duplicateHeaders = computed(() =>
  duplicateWebhookHeaderRows(headerRows.value)
)
const secretIdOf = (value: string): string | null => secretIdFromRef(value)

function setHeaders(rows: WebhookHeaderRow[]) {
  headerRows.value = rows
  const headers = webhookHeadersFromRows(rows)
  if (!isSameWebhookHeaders(headers, configHeaders.value))
    update('headers', headers)
}

function updateHeader(index: number, part: 0 | 1, value: string) {
  setHeaders(updateWebhookHeaderRow(headerRows.value, index, part, value))
}

function addHeader() {
  const rows = addWebhookHeaderRow(headerRows.value)
  if (rows) setHeaders(rows)
}

function removeHeader(index: number) {
  const id = secretIdOf(headerRows.value[index]?.[1] ?? '')
  for (const key of Object.keys(secretDrafts)) delete secretDrafts[+key]
  setHeaders(removeWebhookHeaderRow(headerRows.value, index))
  if (id) void removeUnusedSecret(id)
}

async function replaceHeaderSecret(index: number) {
  const id = secretIdOf(headerRows.value[index]?.[1] ?? '')
  if (!id) return
  if (await replaceSecret(id, secretDrafts[index] ?? '')) {
    delete secretDrafts[index]
  }
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

const { authDraft, saveAuth, removeAuth, replaceSecret, removeUnusedSecret } =
  createWebhookAuthModel({
    getUrl: () => webhook.value.url,
    getSecretId: () => secretId.value,
    getSecretOrigins: (id) => secretsStore.secrets[id]?.origins ?? [],
    isSecretReferenced: (id) =>
      JSON.stringify(session.draft?.commands ?? []).includes(id),
    createId: () => crypto.randomUUID(),
    setSecret: secretsStore.setSecret,
    removeSecret: secretsStore.removeSecret,
    update,
    afterRender: nextTick,
    persist: session.persist,
    isSaved: session.isSaved,
    notifyInvalidOrigin: () => toastKey('settings.invalidBaseUrl', 'error'),
    reportSaveError: (error) => toastError(error, 'settings.keySaveFailed'),
    reportRemoveError: (error) => toastError(error, 'settings.keyRemoveFailed'),
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
.action-field-warning {
  font-size: var(--text-caption);
  color: var(--color-warning);
}

.header-name {
  width: 10rem;
  flex: none;
}
</style>
