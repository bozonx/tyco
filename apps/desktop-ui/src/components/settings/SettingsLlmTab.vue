<template>
  <SettingsSection
    :title="t('settings.llmConnections')"
    :description="t('settings.llmConnectionsHint')"
    bare
  >
    <template #actions>
      <Button sm icon="mdi:plus" @click="addProvider">
        {{ t('settings.addConnection') }}
      </Button>
    </template>

    <div class="flex flex-col gap-3">
      <div
        v-for="provider in llm.providers"
        :key="provider.id"
        class="surface connection-card"
      >
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
            <span class="font-medium truncate">{{
              providerLabel(provider)
            }}</span>
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
                @update:value="provider.name = $event"
              />
            </FieldRow>
            <FieldRow :label="t('settings.baseUrl')">
              <FieldInput
                :value="provider.baseUrl || ''"
                placeholder="http://localhost:11434/v1"
                @update:value="provider.baseUrl = $event"
              />
            </FieldRow>
          </template>

          <FieldRow
            :label="t('settings.apiKey')"
            :hint="keyHint(provider)"
            vertical
          >
            <div class="flex items-center gap-2 w-full">
              <FieldInput
                class="flex-1"
                type="password"
                :value="keyDrafts[provider.id] || ''"
                :placeholder="
                  hasKey(provider.id)
                    ? t('settings.apiKeyReplacePlaceholder')
                    : t('settings.apiKeyPlaceholder')
                "
                @update:value="keyDrafts[provider.id] = $event"
              />
              <Button
                sm
                :disabled="!keyDrafts[provider.id]?.trim()"
                @click="saveKey(provider)"
              >
                {{ t('settings.saveKey') }}
              </Button>
              <Button
                v-if="hasKey(provider.id)"
                sm
                ghost
                class="danger-ghost"
                @click="removeKey(provider.id)"
              >
                {{ t('settings.removeKey') }}
              </Button>
            </div>
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
                sm
                neutral
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
                  <Icon
                    icon="mdi:cube-outline"
                    height="17"
                    class="text-muted"
                  />
                  <span class="font-medium truncate">{{
                    modelLabel(model)
                  }}</span>
                </div>
                <Button
                  sm
                  ghost
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
                  :value="model.model"
                  :placeholder="modelPlaceholder(model.provider)"
                  @update:value="model.model = $event"
                />
              </FieldRow>
              <div class="advanced-toggle">
                <Button
                  xs
                  ghost
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
                <FieldRow :label="t('settings.temperature')">
                  <FieldInput
                    type="number"
                    :value="model.temperature ?? ''"
                    @update:value="setNumber(model, 'temperature', $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.maxTokens')">
                  <FieldInput
                    type="number"
                    :value="model.maxOutputTokens ?? ''"
                    :placeholder="t('settings.providerDefault')"
                    @update:value="setNumber(model, 'maxOutputTokens', $event)"
                  />
                </FieldRow>
              </template>
            </div>
          </div>

          <div class="connection-actions">
            <Button
              v-if="provider.type === 'openai-compatible'"
              sm
              neutral
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
              sm
              ghost
              icon="mdi:trash-can-outline"
              class="danger-ghost ml-auto"
              @click="removeProviderById(provider.id)"
            >
              {{ t('settings.removeProvider') }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    :title="t('settings.modelsForFeatures')"
    :description="t('settings.aiModelUsageHint')"
  >
    <FieldRow
      v-for="task in LLM_TASKS"
      :key="task"
      :label="t(`settings.${task}`)"
      vertical
    >
      <div class="flex flex-col gap-2 w-full">
        <div
          v-for="(modelId, index) in llm.tasks[task]"
          :key="`${task}-${index}`"
          class="assignment-row"
        >
          <span class="assignment-label text-muted">
            {{
              index === 0
                ? t('settings.primaryModel')
                : t('settings.fallbackModel', { index })
            }}
          </span>
          <FieldSelect
            class="flex-1"
            :value="modelId"
            :options="modelOptions"
            @update:value="llm.tasks[task][index] = String($event)"
          />
          <Button
            sm
            ghost
            square
            icon="mdi:close"
            :title="t('settings.removeFallback')"
            :disabled="index === 0"
            @click="llm.tasks[task].splice(index, 1)"
          />
        </div>
        <div>
          <Button
            xs
            ghost
            icon="mdi:plus"
            :disabled="!nextFallback(task)"
            @click="addFallback(task)"
          >
            {{ t('settings.addFallback') }}
          </Button>
        </div>
      </div>
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'

import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import {
  addCompatibleProvider,
  addModel,
  modelLabel,
  removeModel,
  removeProvider,
} from '../../lib/llm/llm-config'
import {
  InvalidLlmBaseUrlError,
  createLlmConnectionChecker,
} from '../../lib/llm/llm-connection'
import { createTauriTransport, tauriNetIpc } from '../../lib/net/tauri-net'
import { useLlmStore } from '../../stores/llm'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from '../common/SettingsSection.vue'
import { Icon } from '@iconify/vue'
import {
  LLM_TASKS,
  type LlmConfig,
  type LlmModel,
  type LlmProvider,
  type LlmTask,
} from '@tyco/shared'

type ConnectionState = 'checking' | 'success' | 'error'
const props = defineProps<{ llm: LlmConfig }>()
const { t } = useI18n()
const { toast, toastText } = useToast()
const llmStore = useLlmStore()
const keyDrafts = reactive<Record<string, string>>({})
const expandedProviders = reactive(new Set<string>())
const expandedModels = reactive(new Set<string>())
const connectionState = reactive<Partial<Record<string, ConnectionState>>>({})
const connectionErrors = reactive<Record<string, string>>({})
const checkLlmConnection = createLlmConnectionChecker({
  fetch: createTauriTransport(tauriNetIpc).fetch,
  hasKey,
})

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
const modelOptions = computed(() =>
  props.llm.models.map((model) => ({
    id: model.id,
    name: `${modelLabel(model)} · ${providerName(model.provider)}`,
  }))
)

function providerLabel(provider: LlmProvider) {
  return provider.name?.trim() || provider.baseUrl?.trim() || provider.id
}
function providerName(id: string) {
  const provider = props.llm.providers.find((item) => item.id === id)
  return provider ? providerLabel(provider) : id
}
function providerIcon(provider: LlmProvider) {
  return PROVIDER_ICONS[provider.type] ?? 'mdi:cube-outline'
}
function modelsFor(id: string) {
  return props.llm.models.filter((model) => model.provider === id)
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
  return Object.hasOwn(llmStore.secrets, id)
}
function statusLabel(provider: LlmProvider) {
  if (connectionState[provider.id] === 'success')
    return t('settings.connectionReady')
  if (provider.type === 'openai-compatible' && !hasKey(provider.id))
    return t('settings.keyNotRequired')
  return hasKey(provider.id)
    ? t('settings.connectionConfigured')
    : t('settings.connectionNotConfigured')
}
function statusClass(provider: LlmProvider) {
  return connectionState[provider.id] === 'success' || hasKey(provider.id)
    ? 'badge-success'
    : 'badge-ghost'
}
function originOf(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? '')
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null
  } catch {
    return null
  }
}
function keyHint(provider: LlmProvider) {
  if (provider.type !== 'openai-compatible') return undefined
  const origins = llmStore.secrets[provider.id]?.origins
  const origin = originOf(provider.baseUrl)
  return origins && origin && !origins.includes(origin)
    ? t('settings.apiKeyBoundTo', { origin: origins.join(', ') })
    : t('settings.apiKeyOptional')
}
async function saveKey(provider: LlmProvider) {
  const value = keyDrafts[provider.id]?.trim()
  if (!value) return
  const origin =
    provider.type === 'openai-compatible' ? originOf(provider.baseUrl) : null
  if (provider.type === 'openai-compatible' && !origin) {
    toast('settings.invalidBaseUrl', 'error')
    return
  }
  try {
    await llmStore.setSecret(provider.id, value, origin ? [origin] : undefined)
    keyDrafts[provider.id] = ''
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}
async function removeKey(id: string) {
  try {
    await llmStore.removeSecret(id)
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}
function addProvider() {
  const provider = addCompatibleProvider(props.llm)
  expandedProviders.add(provider.id)
}
async function removeProviderById(id: string) {
  removeProvider(props.llm, id)
  expandedProviders.delete(id)
  if (hasKey(id)) await removeKey(id)
}
function addModelTo(id: string) {
  const model = addModel(props.llm, id)
  expandedModels.add(model.id)
}
function toggle(set: Set<string>, id: string) {
  if (set.has(id)) set.delete(id)
  else set.add(id)
}
async function checkConnection(provider: LlmProvider) {
  connectionState[provider.id] = 'checking'
  try {
    await checkLlmConnection(provider)
    connectionState[provider.id] = 'success'
  } catch (error) {
    if (error instanceof InvalidLlmBaseUrlError) {
      delete connectionState[provider.id]
      toast('settings.invalidBaseUrl', 'error')
      return
    }
    connectionState[provider.id] = 'error'
    connectionErrors[provider.id] =
      `${t('settings.connectionFailed')}: ${String(error)}`
  }
}
function setNumber(
  model: LlmModel,
  field: 'temperature' | 'maxOutputTokens',
  value: string
) {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
    delete model[field]
    return
  }
  model[field] = field === 'maxOutputTokens' ? Math.round(parsed) : parsed
}
function nextFallback(task: LlmTask) {
  return props.llm.models.find(
    (model) => !props.llm.tasks[task].includes(model.id)
  )
}
function addFallback(task: LlmTask) {
  const model = nextFallback(task)
  if (model) props.llm.tasks[task].push(model.id)
}
onMounted(() => {
  llmStore.refreshSecrets().catch((error: unknown) => {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  })
})
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
  font-size: 0.75rem;
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
  font-size: 0.875rem;
  font-weight: 600;
}
.empty-models {
  padding: var(--space-xl) 0 var(--space-sm);
  font-size: 0.8125rem;
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
.connection-result,
.assignment-label {
  font-size: 0.75rem;
}
.success-text {
  color: var(--color-success);
}
.error-text,
.danger-ghost:not(:disabled):hover {
  color: var(--color-error);
}
.assignment-row {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-sm);
}
@media (max-width: 640px) {
  .assignment-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .assignment-label {
    grid-column: 1 / -1;
  }
}
</style>
