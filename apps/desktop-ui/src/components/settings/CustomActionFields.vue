<template>
  <div class="custom-action-fields">
    <label class="action-field">
      <span class="action-field-label">{{
        t('settings.actionNameLabel')
      }}</span>
      <FieldInput
        :value="item.name"
        :placeholder="t('settings.actionNamePlaceholder')"
        @update:value="update('name', $event)"
      />
    </label>

    <template v-if="item.type === 'script'">
      <div class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionCommandLabel') }}
        </span>
        <ActionTemplateField
          ref="commandRef"
          :value="item.command"
          :placeholder="
            t('settings.actionCommandPlaceholder', { placeholder: TEXT })
          "
          :info="t('settings.actionCommandInfo', { placeholder: TEXT })"
          @update:value="update('command', $event)"
        >
          <Button
            type="button"
            ghost
            square
            sm
            :title="t('settings.actionInsertScript')"
            @click="browseScript"
          >
            <Icon icon="mdi:file-code-outline" width="18" height="18" />
          </Button>
        </ActionTemplateField>
      </div>

      <div class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionWorkingDirLabel') }}
        </span>
        <div class="action-field-row">
          <FieldInput
            class="flex-1"
            :value="item.workingDir"
            :placeholder="t('settings.actionWorkingDirPlaceholder')"
            @update:value="update('workingDir', $event)"
          />
          <Button
            type="button"
            ghost
            square
            sm
            :title="t('settings.browseWorkingDir')"
            @click="browseWorkingDir"
          >
            <Icon icon="mdi:folder-open-outline" width="18" height="18" />
          </Button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionWebhookUrlLabel') }}
        </span>
        <div class="action-field-row">
          <SegmentedControl
            :value="item.method || 'POST'"
            :label="t('settings.actionWebhookMethod')"
            :options="[
              { id: 'POST', name: 'POST' },
              { id: 'GET', name: 'GET' },
            ]"
            @update:value="update('method', $event)"
          />
          <ActionTemplateField
            :value="item.url"
            placeholder="https://"
            :info="t('settings.actionWebhookUrlInfo', { placeholder: TEXT })"
            @update:value="update('url', $event)"
          />
        </div>
      </div>

      <div v-if="(item.method || 'POST') === 'POST'" class="action-field">
        <span class="action-field-label">
          {{ t('settings.actionWebhookBodyLabel') }}
        </span>
        <ActionTemplateField
          multiline
          :value="item.payloadTemplate"
          :placeholder="t('settings.actionWebhookPayloadPlaceholder')"
          :info="t('settings.actionWebhookBodyInfo', { placeholder: TEXT })"
          @update:value="update('payloadTemplate', $event)"
        />
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
          <Button
            type="button"
            ghost
            square
            sm
            :title="t('common.remove')"
            @click="removeHeader(headerIndex)"
          >
            <Icon icon="mdi:close" width="16" height="16" />
          </Button>
        </div>
        <div>
          <Button type="button" ghost sm icon="mdi:plus" @click="addHeader">
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
          <Button sm :disabled="!authDraft.trim()" @click="saveAuth">
            {{ t('common.save') }}
          </Button>
          <Button
            v-if="hasAuth"
            sm
            ghost
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

    <div class="action-field">
      <span class="action-field-label">
        {{ t('settings.actionAfterRunLabel') }}
        <InfoTooltip :text="t('settings.actionAfterRunInfo')" />
      </span>
      <SegmentedControl
        :value="item.afterRun || 'none'"
        :label="t('settings.actionAfterRunLabel')"
        :options="[
          { id: 'none', name: t('settings.actionAfterRunNone') },
          { id: 'showMenu', name: t('settings.actionAfterRunShowMenu') },
        ]"
        @update:value="update('afterRun', $event)"
      />
    </div>

    <div class="action-field-row">
      <FieldCheckbox
        :value="Boolean(item.logOutput)"
        :label="t('settings.actionLogOutput')"
        @update:value="update('logOutput', $event)"
      />
      <InfoTooltip :text="t('settings.actionLogOutputInfo')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import { httpOrigin } from '../../lib/net/secrets'
import { useIpcStore } from '../../stores/ipc'
import { useLlmStore } from '../../stores/llm'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import ActionTemplateField from './ActionTemplateField.vue'
import { Icon } from '@iconify/vue'
import {
  type ScriptMainAction,
  ACTION_TEXT_PLACEHOLDER as TEXT,
  type WebhookMainAction,
  webhookSecretId,
} from '@tyco/shared'

const props = defineProps<{ item: ScriptMainAction | WebhookMainAction }>()

const emit = defineEmits<{
  (event: 'update', field: string, value: unknown): void
}>()

const { t } = useI18n()
const { toast, toastText } = useToast()
const ipcStore = useIpcStore()
const llmStore = useLlmStore()

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
  props.item.type === 'webhook' ? Object.entries(props.item.headers ?? {}) : []
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

const secretId = computed(() => webhookSecretId(props.item.id))
const hasAuth = computed(
  () =>
    props.item.type === 'webhook' &&
    Boolean(props.item.authSecret) &&
    Object.hasOwn(llmStore.secrets, secretId.value)
)
const authOrigins = computed(
  () => llmStore.secrets[secretId.value]?.origins ?? []
)
const authBoundElsewhere = computed(() => {
  if (!hasAuth.value || props.item.type !== 'webhook') return false
  const origin = httpOrigin(props.item.url)
  return Boolean(origin) && !authOrigins.value.includes(origin!)
})

async function saveAuth() {
  if (props.item.type !== 'webhook') return
  const value = authDraft.value.trim()
  const origin = httpOrigin(props.item.url)
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

if (props.item.type === 'webhook' && props.item.authSecret) {
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
  font-size: 0.75rem;
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
  font-size: 0.75rem;
  color: var(--color-warning);
}

.header-name {
  width: 10rem;
  flex: none;
}
</style>
