<template>
  <div class="surface connection-card">
    <DisclosureHeader
      :expanded="expanded"
      :controls="bodyId"
      :title="label"
      :description="providerSummary(provider)"
      :icon="providerIcon(provider)"
      @toggle="emit('toggle')"
    >
      <template #status
        ><span class="badge badge-sm shrink-0" :class="statusClass(provider)">{{
          statusLabel(provider)
        }}</span></template
      >
    </DisclosureHeader>

    <div v-if="expanded" :id="bodyId" class="connection-body">
      <template v-if="provider.type === 'openai-compatible'">
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
          :value="keyDrafts[provider.id] || ''"
          :has-key="hasKey(provider.id)"
          :save="() => saveKey(provider)"
          :remove="() => removeKey(provider.id)"
          @update:value="keyDrafts[provider.id] = $event"
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
        <div
          v-if="!modelsFor(provider.id).length"
          class="empty-models text-muted"
        >
          {{ t('settings.noConnectionModels') }}
        </div>
        <div
          v-for="model in modelsFor(provider.id)"
          :key="model.id"
          class="model-row"
        >
          <div class="model-row-header">
            <div class="flex items-center gap-2 min-w-0">
              <Icon icon="mdi:cube-outline" height="17" class="text-muted" />
              <span class="font-medium truncate">{{ modelLabel(model) }}</span>
            </div>
            <IconButton
              size="sm"
              variant="danger-ghost"
              icon="mdi:trash-can-outline"
              :label="t('settings.removeModel')"
              @click="removeModel(llm, model.id)"
            />
          </div>
          <FieldRow :label="t('settings.name')">
            <FieldInput
              :model-value="model.name || ''"
              @update:model-value="model.name = $event"
            />
          </FieldRow>
          <FieldRow :label="t('settings.modelId')">
            <FieldInput
              :model-value="model.providerModelId"
              :placeholder="modelPlaceholder(model.providerId)"
              @update:model-value="model.providerModelId = $event"
            />
          </FieldRow>
          <div class="advanced-toggle">
            <Button
              size="xs"
              variant="ghost"
              :icon="
                expandedModelIds.has(model.id)
                  ? 'mdi:chevron-up'
                  : 'mdi:tune-variant'
              "
              @click="toggle(expandedModelIds, model.id)"
            >
              {{
                expandedModelIds.has(model.id)
                  ? t('settings.hideAdvanced')
                  : t('settings.showAdvanced')
              }}
            </Button>
          </div>
          <template v-if="expandedModelIds.has(model.id)">
            <FieldRow :label="t('settings.vision')">
              <FieldCheckbox
                :model-value="supportsImages(model)"
                @update:model-value="model.canUseImages = $event"
              />
            </FieldRow>
            <FieldRow
              :label="t('settings.temperature')"
              :error="
                numberErrors[`${model.id}:temperature`]
                  ? t('settings.numberTemperatureInvalid')
                  : undefined
              "
            >
              <FieldNumber
                min="0"
                max="2"
                step="0.1"
                :model-value="
                  numberDrafts[`${model.id}:temperature`] ??
                  model.temperature ??
                  ''
                "
                :aria-invalid="
                  numberErrors[`${model.id}:temperature`] || undefined
                "
                @update:model-value="setNumber(model, 'temperature', $event)"
                @invalid-input="numberErrors[`${model.id}:temperature`] = true"
              />
            </FieldRow>
            <FieldRow
              :label="t('settings.maxTokens')"
              :error="
                numberErrors[`${model.id}:maxOutputTokens`]
                  ? t('settings.numberTokensInvalid')
                  : undefined
              "
            >
              <FieldNumber
                min="1"
                :model-value="
                  numberDrafts[`${model.id}:maxOutputTokens`] ??
                  model.maxOutputTokens ??
                  ''
                "
                :aria-invalid="
                  numberErrors[`${model.id}:maxOutputTokens`] || undefined
                "
                :placeholder="t('settings.providerDefault')"
                @update:model-value="
                  setNumber(model, 'maxOutputTokens', $event)
                "
                @invalid-input="
                  numberErrors[`${model.id}:maxOutputTokens`] = true
                "
              />
            </FieldRow>
            <FieldRow
              :label="t('settings.contextSize')"
              :error="
                numberErrors[`${model.id}:contextWindowTokens`]
                  ? t('settings.numberTokensInvalid')
                  : undefined
              "
            >
              <FieldNumber
                min="1"
                :model-value="
                  numberDrafts[`${model.id}:contextWindowTokens`] ??
                  model.contextWindowTokens ??
                  ''
                "
                :aria-invalid="
                  numberErrors[`${model.id}:contextWindowTokens`] || undefined
                "
                :placeholder="t('settings.providerDefault')"
                @update:model-value="
                  setNumber(model, 'contextWindowTokens', $event)
                "
                @invalid-input="
                  numberErrors[`${model.id}:contextWindowTokens`] = true
                "
              />
            </FieldRow>
          </template>
        </div>
      </div>

      <div class="connection-actions">
        <Button
          v-if="provider.type === 'openai-compatible'"
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
        <span
          v-if="connectionCheckStatusByProviderId[provider.id] === 'success'"
          class="connection-result success-text"
        >
          {{ t('settings.connectionAvailable') }}
        </span>
        <span
          v-if="connectionCheckStatusByProviderId[provider.id] === 'error'"
          class="connection-result error-text"
        >
          {{ connectionErrors[provider.id] }}
        </span>
        <Button
          v-if="provider.type === 'openai-compatible'"
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
  </div>
</template>
<script setup lang="ts">
import { useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { supportsImages } from '../../lib/llm/llm-catalog'
import { modelLabel, removeModel } from '../../lib/llm/llm-config'
import type { createLlmSettingsModel } from '../../lib/llm/llm-settings-model'
import { type SecretsStatus, httpOrigin } from '../../lib/net/secrets'
import Icon from '../common/AppIcon.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
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
const bodyId = useId()
const {
  keyDrafts,
  expandedModelIds,
  connectionCheckStatusByProviderId,
  connectionErrors,
  saveKey,
  removeKey,
  addModelToProvider,
  checkConnection,
  setNumber,
  numberDrafts,
  numberErrors,
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
  'openai-compatible': 'mdi:server-network',
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
  if (provider.type === 'openai-compatible' && !hasKey(provider.id))
    return t('settings.connectionUnchecked')
  return hasKey(provider.id)
    ? t('settings.connectionConfigured')
    : t('settings.connectionNotConfigured')
}
function statusClass(provider: LlmProvider) {
  return connectionCheckStatusByProviderId[provider.id] === 'success'
    ? 'badge-success'
    : 'badge-ghost'
}
function keyHint(provider: LlmProvider) {
  if (provider.type !== 'openai-compatible') return undefined
  const origins = props.secrets[provider.id]?.origins
  const origin = httpOrigin(provider.baseUrl)
  return origins && origin && !origins.includes(origin)
    ? t('settings.apiKeyBoundTo', { origin: origins.join(', ') })
    : t('settings.apiKeyOptional')
}
function toggle(set: Set<string>, id: string) {
  if (set.has(id)) set.delete(id)
  else set.add(id)
}
</script>
<style scoped>
.connection-card {
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
}
.models-hint {
  font-size: var(--text-caption);
  line-height: 1.35;
}
.connection-body {
  border-top: 1px solid var(--app-border-subtle);
}
.models-block {
  padding: var(--space-lg);
  border-top: 1px solid var(--app-border-subtle);
}
.models-header,
.model-row-header,
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
.empty-models {
  padding: var(--space-xl) 0 var(--space-sm);
  font-size: var(--text-control);
  text-align: center;
}
.model-row {
  overflow: hidden;
  margin-top: var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
}
.model-row-header {
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  background: var(--app-surface-raised);
}
.advanced-toggle {
  padding: var(--space-xs) var(--space-md) var(--space-sm);
  text-align: right;
}
.connection-actions {
  justify-content: flex-start;
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--app-border-subtle);
}
.connection-result {
  font-size: var(--text-caption);
}
.success-text {
  color: var(--color-success);
}
.error-text {
  color: var(--color-error);
}
</style>
