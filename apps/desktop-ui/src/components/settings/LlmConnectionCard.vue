<template>
  <DisclosurePanel
    class="connection-card"
    :expanded="expanded"
    :title="label"
    :description="providerSummary(provider)"
    :icon="providerIcon(provider)"
    @toggle="emit('toggle')"
  >
    <template #status
      ><Badge :tone="statusTone(provider)">{{
        statusLabel(provider)
      }}</Badge></template
    >
    <div class="connection-body">
      <template v-if="provider.type === 'openaiCompatible'">
        <FieldRow :label="t('settings.name')">
          <FieldInput
            :model-value="provider.name || ''"
            placeholder="Ollama"
            @update:model-value="emit('update', { name: $event })"
          />
        </FieldRow>
        <FieldRow :label="t('settings.baseUrl')">
          <FieldInput
            :model-value="provider.baseUrl || ''"
            placeholder="http://localhost:11434/v1"
            @update:model-value="emit('update', { baseUrl: $event })"
          />
        </FieldRow>
      </template>

      <FieldRow
        :label="t('settings.apiKey')"
        :hint="keyHint(provider)"
        vertical
      >
        <SecretKeyField
          :model-value="keyDrafts[provider.id] || ''"
          :has-key="hasKey(provider.id)"
          :save="() => saveKey(provider)"
          :remove="() => removeKey(provider.id)"
          @update:model-value="keyDrafts[provider.id] = $event"
        />
      </FieldRow>

      <div class="models-block">
        <div class="models-header">
          <div>
            <div class="models-title">
              {{ t('settings.connectionModels') }}
            </div>
            <div class="models-hint text-muted">
              {{ t('settings.connectionModelsHint') }}
            </div>
          </div>
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:plus"
            @click="addModelToProvider(provider.id)"
          >
            {{ t('settings.addModel') }}
          </Button>
        </div>
        <StateMessage
          v-if="!modelsFor(provider.id).length"
          density="compact"
          :message="t('settings.noConnectionModels')"
        />
        <LlmModelEditor
          v-for="model in modelsFor(provider.id)"
          :key="model.id"
          :model="model"
          :providers="llm.providers"
          :placeholder="modelPlaceholder(model.providerId)"
          :settings="settings"
          @remove="removeModel(llm, $event)"
          @update="Object.assign(model, $event)"
        />
      </div>

      <div class="connection-actions">
        <Button
          v-if="provider.type === 'openaiCompatible'"
          size="sm"
          variant="neutral"
          icon="mdi:connection"
          :disabled="
            connectionCheckStatusByProviderId[provider.id] === 'checking'
          "
          @click="checkConnection(provider)"
        >
          {{
            connectionCheckStatusByProviderId[provider.id] === 'checking'
              ? t('settings.checkingConnection')
              : t('settings.checkConnection')
          }}
        </Button>
        <InlineNotice
          v-if="connectionCheckStatusByProviderId[provider.id] === 'success'"
          kind="success"
          announcement="polite"
          :message="t('settings.connectionAvailable')"
        />
        <InlineNotice
          v-if="connectionCheckStatusByProviderId[provider.id] === 'error'"
          kind="error"
          announcement="polite"
          :message="connectionErrors[provider.id]"
        />
        <Button
          v-if="provider.type === 'openaiCompatible'"
          size="sm"
          variant="danger-ghost"
          icon="mdi:trash-can-outline"
          class="ml-auto"
          @click="emit('remove', provider.id)"
        >
          {{ t('settings.removeProvider') }}
        </Button>
      </div>
    </div>
  </DisclosurePanel>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { removeModel } from '../../lib/llm/llm-config'
import type { createLlmSettingsModel } from '../../lib/llm/llm-settings-model'
import { type SecretsStatus, httpOrigin } from '../../lib/net/secrets'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import DisclosurePanel from '../common/DisclosurePanel.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import LlmModelEditor from './LlmModelEditor.vue'
import SecretKeyField from './SecretKeyField.vue'
import type { LlmConfig, LlmProvider } from '@tyco/shared'

const props = defineProps<{
  expanded: boolean
  provider: LlmProvider
  label: string
  llm: LlmConfig
  settings: ReturnType<typeof createLlmSettingsModel>
  secrets: SecretsStatus
}>()
const emit = defineEmits<{
  (event: 'toggle'): void
  (event: 'remove', id: string): void
  (event: 'update', patch: Partial<Pick<LlmProvider, 'name' | 'baseUrl'>>): void
}>()
const { t } = useI18n()
const {
  keyDrafts,
  connectionCheckStatusByProviderId,
  connectionErrors,
  saveKey,
  removeKey,
  addModelToProvider,
  checkConnection,
} = props.settings
const MODEL_PLACEHOLDERS: Record<string, string> = {
  google: 'gemini-2.5-flash',
  openrouter: 'openai/gpt-4.1-mini',
  deepseek: 'deepseek-chat',
}
const PROVIDER_ICONS: Record<string, string> = {
  google: 'mdi:google',
  openrouter: 'mdi:router-network',
  deepseek: 'mdi:fish',
  openaiCompatible: 'mdi:server-network',
}
function providerIcon(provider: LlmProvider) {
  return PROVIDER_ICONS[provider.type] ?? 'mdi:cube-outline'
}
function modelsFor(id: string) {
  return props.llm.models.filter((model) => model.providerId === id)
}
function providerSummary(provider: LlmProvider) {
  const count = t('settings.modelsCount', {
    count: modelsFor(provider.id).length,
  })
  return provider.baseUrl?.trim()
    ? `${provider.baseUrl.trim()} · ${count}`
    : count
}
function modelPlaceholder(id: string) {
  return MODEL_PLACEHOLDERS[id] ?? 'qwen2.5:7b'
}
function hasKey(id: string) {
  return Object.hasOwn(props.secrets, id)
}
function statusLabel(provider: LlmProvider) {
  if (connectionCheckStatusByProviderId[provider.id] === 'success')
    return t('settings.connectionReady')
  if (provider.type === 'openaiCompatible' && !hasKey(provider.id))
    return t('settings.connectionUnchecked')
  return hasKey(provider.id)
    ? t('settings.connectionConfigured')
    : t('settings.connectionNotConfigured')
}
function statusTone(provider: LlmProvider) {
  return connectionCheckStatusByProviderId[provider.id] === 'success'
    ? 'success'
    : 'neutral'
}
function keyHint(provider: LlmProvider) {
  if (provider.type !== 'openaiCompatible') return undefined
  const origins = props.secrets[provider.id]?.origins
  const origin = httpOrigin(provider.baseUrl)
  return origins && origin && !origins.includes(origin)
    ? t('settings.apiKeyBoundTo', { origin: origins.join(', ') })
    : t('settings.apiKeyOptional')
}
</script>
<style scoped>
.models-hint {
  font-size: var(--text-caption);
  line-height: 1.35;
}
.models-block {
  padding: var(--space-lg);
  border-top: 1px solid var(--app-border-subtle);
}
.models-header,
.connection-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.models-title {
  font-size: var(--text-body);
  font-weight: 600;
}

.connection-actions {
  justify-content: flex-start;
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--app-border-subtle);
}
</style>
