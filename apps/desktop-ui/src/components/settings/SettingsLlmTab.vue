<template>
  <SettingsSection
    :title="t('settings.llmProviders')"
    :description="t('settings.llmProvidersHint')"
    bare
  >
    <template #actions>
      <Button sm icon="mdi:plus" @click="addProvider">
        {{ t('settings.addCompatibleProvider') }}
      </Button>
    </template>

    <div class="flex flex-col gap-3">
      <div
        v-for="provider in llm.providers"
        :key="provider.id"
        class="surface model-card"
      >
        <div class="model-card-header">
          <div class="flex items-center gap-2 min-w-0">
            <Icon
              :icon="providerIcon(provider)"
              height="18"
              class="text-muted shrink-0"
            />
            <span class="font-medium truncate">
              {{ providerLabel(provider) }}
            </span>
            <span
              class="badge badge-sm shrink-0"
              :class="hasKey(provider.id) ? 'badge-success' : 'badge-ghost'"
            >
              {{
                hasKey(provider.id)
                  ? t('settings.apiKeySaved')
                  : t('settings.apiKeyMissing')
              }}
            </span>
          </div>
          <Button
            v-if="provider.type === 'openai-compatible'"
            sm
            ghost
            icon="mdi:trash-can-outline"
            class="danger-ghost"
            @click="removeProviderById(provider.id)"
          >
            {{ t('settings.removeProvider') }}
          </Button>
        </div>

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
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    :title="t('settings.llmModels')"
    :description="t('settings.llmModelsHint')"
    bare
  >
    <template #actions>
      <Button sm icon="mdi:plus" @click="addModelToFirstProvider">
        {{ t('settings.addModel') }}
      </Button>
    </template>

    <div class="flex flex-col gap-3">
      <div
        v-for="model in llm.models"
        :key="model.id"
        class="surface model-card"
      >
        <div class="model-card-header">
          <div class="flex items-center gap-2 min-w-0">
            <Icon
              icon="mdi:cube-outline"
              height="18"
              class="text-muted shrink-0"
            />
            <span class="font-medium truncate">{{ modelLabel(model) }}</span>
          </div>
          <Button
            sm
            ghost
            icon="mdi:trash-can-outline"
            class="danger-ghost"
            @click="removeModel(llm, model.id)"
          >
            {{ t('settings.removeModel') }}
          </Button>
        </div>

        <FieldRow :label="t('settings.name')">
          <FieldInput
            :value="model.name || ''"
            @update:value="model.name = $event"
          />
        </FieldRow>
        <FieldRow :label="t('settings.provider')">
          <FieldSelect
            :value="model.provider"
            :options="providerOptions"
            @update:value="model.provider = String($event)"
          />
        </FieldRow>
        <FieldRow :label="t('settings.model')">
          <FieldInput
            :value="model.model"
            :placeholder="modelPlaceholder(model.provider)"
            @update:value="model.model = $event"
          />
        </FieldRow>
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
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    :title="t('settings.aiModelUsage')"
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
          class="flex items-center gap-2"
        >
          <span class="chain-index text-muted">{{ index + 1 }}</span>
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
            :disabled="llm.tasks[task].length <= 1"
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

const props = defineProps<{ llm: LlmConfig }>()

const { t } = useI18n()
const { toast, toastText } = useToast()
const llmStore = useLlmStore()

/** Typed keys, until saved; never read back from the store */
const keyDrafts = reactive<Record<string, string>>({})

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

const providerOptions = computed(() =>
  props.llm.providers.map((provider) => ({
    id: provider.id,
    name: providerLabel(provider),
  }))
)

const modelOptions = computed(() =>
  props.llm.models.map((model) => ({
    id: model.id,
    name: `${modelLabel(model)} · ${providerName(model.provider)}`,
  }))
)

function providerLabel(provider: LlmProvider) {
  return provider.name?.trim() || provider.baseUrl?.trim() || provider.id
}

function providerName(providerId: string) {
  const provider = props.llm.providers.find((item) => item.id === providerId)
  return provider ? providerLabel(provider) : providerId
}

function providerIcon(provider: LlmProvider) {
  return PROVIDER_ICONS[provider.type] ?? 'mdi:cube-outline'
}

function modelPlaceholder(providerId: string) {
  return MODEL_PLACEHOLDERS[providerId] ?? 'qwen2.5:7b'
}

function hasKey(providerId: string) {
  return Object.hasOwn(llmStore.secrets, providerId)
}

function originOf(baseUrl: string | undefined): string | null {
  try {
    const url = new URL(baseUrl?.trim() ?? '')
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null
  } catch {
    return null
  }
}

/** A saved key only goes to the address it was saved for */
function keyHint(provider: LlmProvider) {
  if (provider.type !== 'openai-compatible') return undefined

  const origins = llmStore.secrets[provider.id]?.origins
  const origin = originOf(provider.baseUrl)
  if (origins && origin && !origins.includes(origin)) {
    return t('settings.apiKeyBoundTo', { origin: origins.join(', ') })
  }
  return t('settings.apiKeyOptional')
}

async function saveKey(provider: LlmProvider) {
  const value = keyDrafts[provider.id]?.trim()
  if (!value) return

  let origins: string[] | undefined
  if (provider.type === 'openai-compatible') {
    const origin = originOf(provider.baseUrl)
    if (!origin) {
      toast('settings.invalidBaseUrl', 'error')
      return
    }
    origins = [origin]
  }

  try {
    await llmStore.setSecret(provider.id, value, origins)
    keyDrafts[provider.id] = ''
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}

async function removeKey(providerId: string) {
  try {
    await llmStore.removeSecret(providerId)
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}

function addProvider() {
  addCompatibleProvider(props.llm)
}

async function removeProviderById(providerId: string) {
  removeProvider(props.llm, providerId)
  if (hasKey(providerId)) await removeKey(providerId)
}

function addModelToFirstProvider() {
  const provider =
    props.llm.providers.find((item) => item.type === 'openai-compatible') ??
    props.llm.providers[0]
  addModel(props.llm, provider.id)
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
.model-card {
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
}

.model-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}

.danger-ghost:not(:disabled):hover {
  color: var(--color-error);
}

.chain-index {
  width: 1.25rem;
  font-size: 0.8125rem;
  text-align: right;
}
</style>
