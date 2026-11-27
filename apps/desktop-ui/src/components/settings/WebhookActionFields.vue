<template>
  <div class="custom-action-fields">
    <FieldRow
      group
      class="action-field"
      vertical
      density="compact"
      :label="t('settings.actionWebhookUrlLabel')"
      :info="t('settings.actionWebhookUrlInfo', { placeholder: TEXT })"
      :warning="warningsOf('url')"
    >
      <div class="action-field-row">
        <SegmentedControl
          class="shrink-0"
          :model-value="webhook.method || 'POST'"
          :label="t('settings.actionWebhookMethod')"
          :options="[
            { id: 'POST', name: 'POST' },
            { id: 'GET', name: 'GET' },
          ]"
          @update:model-value="update('method', $event)"
        />
        <ActionTemplateField
          can-use-variables
          :model-value="webhook.url"
          placeholder="https://"
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
      :info="t('settings.actionWebhookBodyInfo', { placeholder: TEXT })"
      :warning="warningsOf('payloadTemplate')"
    >
      <ActionTemplateField
        multiline
        can-use-variables
        :model-value="webhook.payloadTemplate"
        :placeholder="t('settings.actionWebhookPayloadPlaceholder')"
        @update:model-value="update('payloadTemplate', $event)"
      />
    </FieldRow>

    <FieldRow
      class="action-field"
      vertical
      density="compact"
      :label="t('settings.actionWebhookHeadersLabel')"
      :info="t('settings.actionWebhookHeadersInfo')"
      :warning="warningsOf('headers')"
    >
      <div v-if="headerRows.length" class="header-rows">
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
          <template v-if="secretRows[headerIndex]">
            <FieldInput
              class="flex-1"
              type="password"
              autocomplete="off"
              :aria-label="t('settings.actionWebhookHeaderValue')"
              :model-value="secretDrafts[headerIndex] ?? ''"
              :placeholder="
                secretIdOf(header[1])
                  ? t('settings.actionWebhookHeaderReplacePlaceholder')
                  : t('settings.actionWebhookHeaderSecretPlaceholder')
              "
              @update:model-value="secretDrafts[headerIndex] = $event"
              @keydown.enter.prevent="saveHeaderValue(headerIndex)"
            />
            <Button
              variant="primary"
              size="sm"
              :disabled="!canSaveHeaderValue(headerIndex)"
              @click="saveHeaderValue(headerIndex)"
            >
              {{ t('common.save') }}
            </Button>
          </template>
          <ActionTemplateField
            v-else
            can-use-variables
            without-text
            :aria-label="t('settings.actionWebhookHeaderValue')"
            :model-value="header[1]"
            :placeholder="t('settings.actionWebhookHeaderValue')"
            @update:model-value="updateHeader(headerIndex, 1, $event)"
          />
          <IconButton
            variant="ghost"
            size="sm"
            :icon="
              secretRows[headerIndex]
                ? 'mdi:lock'
                : 'mdi:lock-open-variant-outline'
            "
            :label="
              secretRows[headerIndex]
                ? t('settings.actionWebhookHeaderMakePlain')
                : t('settings.actionWebhookHeaderMakeSecret')
            "
            :aria-pressed="secretRows[headerIndex] ? 'true' : 'false'"
            data-testid="header-secret-toggle"
            @click="toggleSecret(headerIndex)"
          />
          <IconButton
            variant="ghost"
            size="sm"
            @click="removeHeader(headerIndex)"
            :label="t('common.remove')"
            icon="mdi:close"
          />
        </div>
      </div>
      <p v-if="hasUnsavedHeaderValue" class="action-field-hint text-muted">
        {{
          originHere
            ? t('settings.actionWebhookHeaderUnsaved')
            : t('settings.actionWebhookHeaderNeedsUrl')
        }}
      </p>
      <p v-if="hasHeaderMissingHere" class="action-field-warning">
        {{ t('settings.secretNotSetOnDevice') }}
      </p>
      <p v-if="headerSecretOrigins.length" class="action-field-warning">
        {{
          t('settings.apiKeyBoundTo', {
            origin: headerSecretOrigins.join(', '),
          })
        }}
      </p>
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
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { useCommandValidation } from '../../composables/use-command-validation'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsVariables } from '../../composables/use-settings-variables'
import useToast from '../../composables/use-toast'
import { webhookOperationConfig } from '../../lib/commands/command-config'
import { isSecretReferenced } from '../../lib/commands/command-secrets'
import {
  type WebhookHeaderRow,
  addWebhookHeaderRow,
  duplicateWebhookHeaderRows,
  isSameWebhookHeaders,
  isSensitiveHeaderName,
  removeWebhookHeaderRow,
  updateWebhookHeaderRow,
  webhookHeaderRows,
  webhookHeadersFromRows,
} from '../../lib/commands/webhook-header-rows'
import { createWebhookSecretsModel } from '../../lib/commands/webhook-secrets-model'
import { clientLogger } from '../../lib/logger'
import { httpOrigin, secretIdFromRef, secretRef } from '../../lib/net/secrets'
import { useSecretsStore } from '../../stores/secrets'
import { useSettingsSessionStore } from '../../stores/settings-session'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import ActionTemplateField from './ActionTemplateField.vue'
import type { CommandConfig } from '@tyco/shared'
import {
  ACTION_TEXT_PLACEHOLDER as TEXT,
  substituteVariables,
} from '@tyco/shared'

const props = defineProps<{ command: CommandConfig }>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
const warningsOf = useCommandValidation(() => props.command)
function update(field: string, value: unknown) {
  emit('update', field, value)
}

const webhook = computed(() => webhookOperationConfig(props.command))
const variables = useSettingsVariables()
/** The URL as it is on this device; empty when a variable has no value here */
const urlHere = computed(() => {
  const url = substituteVariables(
    webhook.value.url.trim(),
    variables(),
    'url',
    ''
  )
  return url.ok ? url.value : ''
})
const secretsStore = useSecretsStore()
const { toastKey, toastError, toastText } = useToast()
// the rows live here, so a row without a name, with a repeated one or
// with a secret value not saved yet is kept while it is edited. The config
// gets the named headers: a plain value as it is, variables and all, and a
// secret one as the reference to its value in the secret store
const headerRows = ref<WebhookHeaderRow[]>([])
/** Which rows hold a secret value */
const secretRows = ref<boolean[]>([])
/** The secret value typed into each row, not saved yet */
const secretDrafts = ref<string[]>([])
const configHeaders = computed(() =>
  props.command.operationId === 'webhook' ? webhook.value.headers : {}
)
const secretIdOf = (value: string): string | null => secretIdFromRef(value)
/** A secret row goes to the config only once its value is saved */
const configHeadersOf = (rows: readonly WebhookHeaderRow[]) =>
  webhookHeadersFromRows(
    rows.filter(
      ([, value], index) => !secretRows.value[index] || secretIdOf(value)
    )
  )
watch(
  [() => props.command.id, configHeaders],
  ([id], [previousId]) => {
    if (
      id === previousId &&
      isSameWebhookHeaders(
        configHeadersOf(headerRows.value),
        configHeaders.value
      )
    )
      return
    headerRows.value = webhookHeaderRows(configHeaders.value)
    secretRows.value = headerRows.value.map(([, value]) =>
      Boolean(secretIdOf(value))
    )
    secretDrafts.value = headerRows.value.map(() => '')
  },
  { immediate: true }
)
const duplicateHeaders = computed(() =>
  duplicateWebhookHeaderRows(headerRows.value)
)
/** The origin a value is bound to: the one of the URL on this device */
const originHere = computed(() => httpOrigin(urlHere.value))
const hasUnsavedHeaderValue = computed(() =>
  secretDrafts.value.some(
    (draft, index) => secretRows.value[index] && draft.trim()
  )
)
const canSaveHeaderValue = (index: number) =>
  Boolean(
    originHere.value &&
    secretDrafts.value[index]?.trim() &&
    headerRows.value[index]?.[0].trim()
  )
const withAt = <T,>(items: readonly T[], index: number, item: T) =>
  items.map((current, i) => (i === index ? item : current))

function setHeaders(rows: WebhookHeaderRow[]) {
  headerRows.value = rows
  const headers = configHeadersOf(rows)
  if (!isSameWebhookHeaders(headers, configHeaders.value))
    update('headers', headers)
}

function updateHeader(index: number, part: 0 | 1, value: string) {
  // a name that tells of a key makes a new, empty row secret
  if (
    part === 0 &&
    !secretRows.value[index] &&
    !headerRows.value[index]?.[1] &&
    isSensitiveHeaderName(value)
  )
    secretRows.value = withAt(secretRows.value, index, true)
  setHeaders(updateWebhookHeaderRow(headerRows.value, index, part, value))
}

function addHeader() {
  const rows = addWebhookHeaderRow(headerRows.value)
  if (!rows) return
  secretRows.value = [...secretRows.value, false]
  secretDrafts.value = [...secretDrafts.value, '']
  setHeaders(rows)
}

function removeHeader(index: number) {
  const id = secretIdOf(headerRows.value[index]?.[1] ?? '')
  const without = <T,>(items: readonly T[]) =>
    items.filter((_, i) => i !== index)
  secretRows.value = without(secretRows.value)
  secretDrafts.value = without(secretDrafts.value)
  setHeaders(removeWebhookHeaderRow(headerRows.value, index))
  if (id) void removeUnusedSecret(id)
}

/**
 * Makes a value secret or plain. A plain value waits in the field to be saved
 * as a secret; a secret one is not shown back, so a plain value starts empty
 * and the stored one is removed once no config refers to it
 */
function toggleSecret(index: number) {
  const value = headerRows.value[index]?.[1] ?? ''
  const isSecret = !secretRows.value[index]
  secretRows.value = withAt(secretRows.value, index, isSecret)
  secretDrafts.value = withAt(secretDrafts.value, index, isSecret ? value : '')
  setHeaders(updateWebhookHeaderRow(headerRows.value, index, 1, ''))
  const id = secretIdOf(value)
  if (id) void removeUnusedSecret(id)
}

/**
 * Stores the typed value in the secret store: under the id the header has, or
 * under a new one that the header then refers to
 */
async function saveHeaderValue(index: number) {
  if (!canSaveHeaderValue(index)) return
  const value = secretDrafts.value[index] ?? ''
  const id = secretIdOf(headerRows.value[index]?.[1] ?? '')
  const saved = id
    ? (await replaceSecret(id, value)) && id
    : await createSecret(value)
  if (!saved) return
  secretDrafts.value = withAt(secretDrafts.value, index, '')
  if (!id) updateHeader(index, 1, secretRef(saved))
}

/** Secret headers whose value this device has not been given yet */
const hasHeaderMissingHere = computed(() =>
  headerRows.value.some(([, value]) => {
    const id = secretIdOf(value)
    return Boolean(id) && !Object.hasOwn(secretsStore.secrets, id!)
  })
)
/**
 * The origins of the secret headers that do not go to the URL of the webhook:
 * the proxy refuses to send them there until their value is saved again
 */
const headerSecretOrigins = computed(() => {
  const origin = originHere.value
  if (!origin) return []
  const elsewhere = headerRows.value.flatMap(([, value]) => {
    const id = secretIdOf(value)
    const origins = id ? (secretsStore.secrets[id]?.origins ?? []) : []
    return origins.length && !origins.includes(origin) ? origins : []
  })
  return [...new Set(elsewhere)]
})

const session = useSettingsSessionStore()
const { createSecret, replaceSecret, removeUnusedSecret } =
  createWebhookSecretsModel({
    getUrl: () => webhook.value.url,
    createId: () => crypto.randomUUID(),
    isSecretReferenced: (id) =>
      isSecretReferenced(session.draft?.commands ?? [], id),
    setSecret: secretsStore.setSecret,
    removeSecret: secretsStore.removeSecret,
    afterRender: nextTick,
    persist: session.persist,
    isSaved: session.isSaved,
    notifyInvalidOrigin: () => toastKey('settings.invalidBaseUrl', 'error'),
    variables,
    notifyVariablesNotSet: (names) =>
      toastText(`${t('toast.variablesNotSet')}\n${names.join(', ')}`, 'error'),
    notifySavedOnDevice: () => toastKey('settings.keySavedOnDevice', 'success'),
    reportSaveError: (error) => toastError(error, 'settings.keySaveFailed'),
    reportRemoveError: (error) => toastError(error, 'settings.keyRemoveFailed'),
  })

onMounted(() => {
  const hasSecretHeader = headerRows.value.some(([, value]) =>
    Boolean(secretIdOf(value))
  )
  if (hasSecretHeader)
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

.action-field-hint {
  font-size: var(--text-caption);
}

.header-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 0.5rem);
}

.header-name {
  width: 10rem;
  flex: none;
}
</style>
