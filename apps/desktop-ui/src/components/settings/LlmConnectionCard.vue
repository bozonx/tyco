<template>
  <div class="surface connection-card">
    <button
      type="button"
      class="connection-summary"
      :aria-expanded="expandedProviders.has(provider.id)"
      @click="toggle(expandedProviders, provider.id)"
    >
      <Icon
        :icon="providerIcon(provider)"
        height="18"
        class="text-muted shrink-0"
      />
      <span class="connection-title">
        <span class="font-medium truncate">{{ label }}</span>
        <span class="connection-meta text-muted truncate">
          {{ providerSummary(provider) }}
        </span>
      </span>
      <span class="badge badge-sm shrink-0" :class="statusClass(provider)">
        {{ statusLabel(provider) }}
      </span>
      <Icon
        :icon="
          expandedProviders.has(provider.id)
            ? 'mdi:chevron-up'
            : 'mdi:chevron-down'
        "
        height="18"
        class="text-muted shrink-0"
      />
    </button>

    <div v-if="expandedProviders.has(provider.id)" class="connection-body">
      <template v-if="provider.type === 'openai-compatible'">
        <FieldRow :label="t('settings.name')">
          <FieldInput
            :value="provider.name || ''"
            placeholder="Ollama"
            @update:value="emit('update', { name: $event })"
          />
        </FieldRow>
        <FieldRow :label="t('settings.baseUrl')">
          <FieldInput
            :value="provider.baseUrl || ''"
            placeholder="http://localhost:11434/v1"
            @update:value="emit('update', { baseUrl: $event })"
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
            @click="addModelTo(provider.id)"
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
            <Button
              size="sm"
              variant="ghost"
              square
              icon="mdi:trash-can-outline"
              class="danger-ghost"
              :title="t('settings.removeModel')"
              @click="removeModel(llm, model.id)"
            />
          </div>
          <FieldRow :label="t('settings.name')">
            <FieldInput
              :value="model.name || ''"
              @update:value="model.name = $event"
            />
          </FieldRow>
          <FieldRow :label="t('settings.modelId')">
            <FieldInput
              :value="model.providerModelId"
              :placeholder="modelPlaceholder(model.providerId)"
              @update:value="model.providerModelId = $event"
            />
          </FieldRow>
          <div class="advanced-toggle">
            <Button
              size="xs"
              variant="ghost"
              :icon="
                expandedModels.has(model.id)
                  ? 'mdi:chevron-up'
                  : 'mdi:tune-variant'
              "
              @click="toggle(expandedModels, model.id)"
            >
              {{
                expandedModels.has(model.id)
                  ? t('settings.hideAdvanced')
                  : t('settings.showAdvanced')
              }}
            </Button>
          </div>
          <template v-if="expandedModels.has(model.id)">
            <FieldRow :label="t('settings.vision')">
              <FieldCheckbox
                :value="supportsImages(model)"
                @update:value="model.canUseImages = $event"
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
                :value="
                  numberDrafts[`${model.id}:temperature`] ??
                  model.temperature ??
                  ''
                "
                :aria-invalid="
                  numberErrors[`${model.id}:temperature`] || undefined
                "
                @update:value="setNumber(model, 'temperature', $event)"
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
                :value="
                  numberDrafts[`${model.id}:maxOutputTokens`] ??
                  model.maxOutputTokens ??
                  ''
                "
                :aria-invalid="
                  numberErrors[`${model.id}:maxOutputTokens`] || undefined
                "
                :placeholder="t('settings.providerDefault')"
                @update:value="setNumber(model, 'maxOutputTokens', $event)"
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
                :value="
                  numberDrafts[`${model.id}:contextWindowTokens`] ??
                  model.contextWindowTokens ??
                  ''
                "
                :aria-invalid="
                  numberErrors[`${model.id}:contextWindowTokens`] || undefined
                "
                :placeholder="t('settings.providerDefault')"
                @update:value="setNumber(model, 'contextWindowTokens', $event)"
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
          :disabled="connectionState[provider.id] === 'checking'"
          @click="checkConnection(provider)"
        >
          {{
            connectionState[provider.id] === 'checking'
              ? t('settings.checkingConnection')
              : t('settings.checkConnection')
          }}
        </Button>
        <span
          v-if="connectionState[provider.id] === 'success'"
          class="connection-result success-text"
        >
          {{ t('settings.connectionAvailable') }}
        </span>
        <span
          v-if="connectionState[provider.id] === 'error'"
          class="connection-result error-text"
        >
          {{ connectionErrors[provider.id] }}
        </span>
        <Button
          v-if="provider.type === 'openai-compatible'"
          size="sm"
          variant="ghost"
          icon="mdi:trash-can-outline"
          class="danger-ghost ml-auto"
          @click="emit('remove', provider.id)"
        >
          {{ t('settings.removeProvider') }}
        </Button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { supportsImages } from '../../lib/llm/llm-catalog'
import { modelLabel, removeModel } from '../../lib/llm/llm-config'
import type { createLlmSettingsModel } from '../../lib/llm/llm-settings-model'
import { type SecretsStatus, httpOrigin } from '../../lib/net/secrets'
import Icon from '../common/AppIcon.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import SecretKeyField from './SecretKeyField.vue'
import type { LlmConfig, LlmProvider } from '@tyco/shared'

const props = defineProps<{
  provider: LlmProvider
  label: string
  llm: LlmConfig
  settings: ReturnType<typeof createLlmSettingsModel>
  secrets: SecretsStatus
}>()
const emit = defineEmits<{
  (event: 'remove', id: string): void
  (event: 'update', patch: Partial<Pick<LlmProvider, 'name' | 'baseUrl'>>): void
}>()
const { t } = useI18n()
const {
  keyDrafts,
  expandedProviders,
  expandedModels,
  connectionState,
  connectionErrors,
  saveKey,
  removeKey,
  addModelTo,
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
  if (connectionState[provider.id] === 'success')
    return t('settings.connectionReady')
  if (provider.type === 'openai-compatible' && !hasKey(provider.id))
    return t('settings.connectionUnchecked')
  return hasKey(provider.id)
    ? t('settings.connectionConfigured')
    : t('settings.connectionNotConfigured')
}
function statusClass(provider: LlmProvider) {
  return connectionState[provider.id] === 'success'
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
.connection-summary {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-md) var(--space-lg);
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: var(--app-surface-raised);
}
.connection-summary:hover {
  background-color: var(--app-surface-sunken);
}
.connection-title {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.connection-meta,
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
.error-text,
.danger-ghost:not(:disabled):hover {
  color: var(--color-error);
}
</style>
