<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.llmConnections')"
      :description="t('settings.llmConnectionsHint')"
      bare
    >
      <template #actions>
        <Button
          variant="primary"
          size="sm"
          icon="mdi:plus"
          @click="addProvider"
        >
          {{ t('settings.addConnection') }}
        </Button>
      </template>

      <div class="flex flex-col gap-3">
        <SecretStorageNotice />
        <LlmConnectionCard
          v-for="provider in llm.providers"
          :key="provider.id"
          :provider="provider"
          :expanded="settings.expandedProviderIds.has(provider.id)"
          @toggle="toggleProvider(provider.id)"
          :label="providerLabel(provider)"
          :llm="llm"
          :settings="settings"
          :secrets="secretsStore.secrets"
          @remove="pendingProviderId = $event"
          @update="Object.assign(provider, $event)"
        />
      </div>
    </SettingsSection>

    <SettingsSection :title="t('settings.modelsForFeatures')">
      <div class="model-mode-switch">
        <SegmentedControl
          :model-value="modelMode"
          :label="t('settings.modelsForFeatures')"
          :options="modelModeOptions"
          @update:model-value="setModelMode($event as LlmModelMode)"
        />
      </div>

      <div v-if="modelMode === 'all'" class="single-model-field">
        <FieldSelect
          :model-value="commonModelId"
          :options="taskModelOptions"
          @update:model-value="setCommonModel(String($event ?? ''))"
        />
      </div>

      <div v-else class="per-task-fields">
        <FieldRow
          v-for="task in LLM_TASKS"
          :key="task"
          :label="t(TASK_LABEL_KEYS[task])"
        >
          <FieldSelect
            :model-value="llm.tasks[task]?.modelId"
            :options="taskModelOptions"
            @update:model-value="setTaskModel(task, String($event ?? ''))"
          />
        </FieldRow>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('settings.sectionLlmImages')">
      <FieldRow
        :label="t('settings.chatImageQuality')"
        :info="t('settings.chatImageQualityHint')"
      >
        <FieldSelect
          :model-value="llm.imageQuality"
          :options="imageQualityOptions"
          @update:model-value="llm.imageQuality = $event as LlmImageQuality"
        />
      </FieldRow>
    </SettingsSection>

    <ConfirmModal
      :open="pendingProviderId !== null"
      :title="t('common.delete')"
      :message="t('settings.removeProviderConfirm')"
      danger
      @confirm="confirmProviderRemoval"
      @cancel="pendingProviderId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { describeError } from '../../lib/errors/describe-error'
import { modelLabel } from '../../lib/llm/llm-config'
import { createLlmConnectionChecker } from '../../lib/llm/llm-connection'
import { createLlmSettingsModel } from '../../lib/llm/llm-settings-model'
import { httpOrigin } from '../../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../../lib/net/tauri-net'
import { useSecretsStore } from '../../stores/secrets'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import LlmConnectionCard from './LlmConnectionCard.vue'
import SecretStorageNotice from './SecretStorageNotice.vue'
import SettingsSection from './SettingsSection.vue'
import {
  LLM_TASKS,
  type LlmImageQuality,
  type LlmModelMode,
  type LlmProvider,
  llmSecretId,
} from '@tyco/shared'

const TASK_LABEL_KEYS = {
  translation: 'action.translationMenu',
  voiceCorrection: 'settings.voiceTextCorrection',
  correction: 'settings.textCorrection',
  aiTask: 'settings.tasksTab',
  transformation: 'settings.transformationsTab',
  styling: 'settings.stylingTab',
} as const

const { t } = useI18n()
const { draft: userConfig, operations } = useSettingsContext()
const llm = computed(() => userConfig.value.llm)
const { toastKey, toastError } = useToast()
const secretsStore = useSecretsStore()
const checkLlmConnection = createLlmConnectionChecker({
  fetch: createTauriTransport(tauriNetIpc).fetch,
  hasKey,
  getModelId: (providerId) =>
    llm.value.models.find((model) => model.providerId === providerId)
      ?.providerModelId,
})
const settings = createLlmSettingsModel({
  getConfig: () => llm.value,
  setSecret: (id, value, origins) => secretsStore.setSecret(id, value, origins),
  removeSecret: (id) => secretsStore.removeSecret(id),
  checkConnection: checkLlmConnection,
  notifyKeyError: (error) => toastError(error, 'settings.keySaveFailed'),
  notifyInvalidUrl: () => toastKey('settings.invalidBaseUrl', 'error'),
  formatConnectionError: (error) =>
    `${t('settings.connectionFailed')}\n${describeError(error, t)}`,
  providerRemoved: (id) => void operations.finishProviderRemoval(id),
})
const { addProvider, removeProviderById, dispose } = settings
onBeforeUnmount(dispose)
const pendingProviderId = ref<string | null>(null)

const areAllTaskModelsSame = computed(() => {
  const modelIds = LLM_TASKS.map((task) => llm.value.tasks[task]?.modelId ?? '')
  return modelIds.every((id) => id === modelIds[0])
})

const modelMode = computed<LlmModelMode>(() => {
  if (llm.value.modelMode) return llm.value.modelMode
  return areAllTaskModelsSame.value ? 'all' : 'perTask'
})

const modelModeOptions = computed(() => [
  { id: 'all' as const, name: t('settings.modelModeAll') },
  { id: 'perTask' as const, name: t('settings.modelModePerTask') },
])

const commonModelId = computed(() => {
  if (llm.value.commonModelId !== undefined) {
    return llm.value.commonModelId
  }
  return llm.value.tasks[LLM_TASKS[0]]?.modelId || llm.value.models[0]?.id || ''
})

if (llm.value.commonModelId === undefined) {
  llm.value.commonModelId = commonModelId.value
}

function setModelMode(mode: LlmModelMode) {
  llm.value.modelMode = mode
  if (mode === 'all') {
    if (!llm.value.customTaskModels) {
      llm.value.customTaskModels = {}
    }
    for (const task of LLM_TASKS) {
      llm.value.customTaskModels[task] = llm.value.tasks[task]?.modelId ?? ''
    }

    const commonId = commonModelId.value
    llm.value.commonModelId = commonId
    for (const task of LLM_TASKS) {
      const taskConfig = llm.value.tasks[task]
      if (taskConfig) {
        taskConfig.modelId = commonId
      }
    }
  } else {
    const saved = llm.value.customTaskModels
    const fallback = commonModelId.value
    for (const task of LLM_TASKS) {
      const taskConfig = llm.value.tasks[task]
      if (taskConfig) {
        const savedId = saved?.[task]
        taskConfig.modelId = savedId !== undefined ? savedId : fallback
      }
    }
  }
}

function setCommonModel(modelId: string) {
  llm.value.commonModelId = modelId
  for (const task of LLM_TASKS) {
    const taskConfig = llm.value.tasks[task]
    if (taskConfig) {
      taskConfig.modelId = modelId
    }
  }
}

function setTaskModel(task: (typeof LLM_TASKS)[number], modelId: string) {
  const taskConfig = llm.value.tasks[task]
  if (taskConfig) {
    taskConfig.modelId = modelId
  }
  if (!llm.value.customTaskModels) {
    llm.value.customTaskModels = {}
  }
  llm.value.customTaskModels[task] = modelId
}

const imageQualityOptions = computed(() => [
  { id: 'economy', name: t('settings.imageQualityEconomy') },
  { id: 'balanced', name: t('settings.imageQualityBalanced') },
  { id: 'original', name: t('settings.imageQualityOriginal') },
])
function toggleProvider(providerId: string) {
  const expanded = settings.expandedProviderIds
  if (expanded.has(providerId)) expanded.delete(providerId)
  else expanded.add(providerId)
}
function confirmProviderRemoval() {
  if (pendingProviderId.value) removeProviderById(pendingProviderId.value)
  pendingProviderId.value = null
}

const modelOptions = computed(() =>
  llm.value.models
    .filter((model) => {
      const provider = llm.value.providers.find(
        (item) => item.id === model.providerId
      )
      return (
        Boolean(model.providerModelId.trim()) &&
        Boolean(
          provider &&
          (provider.type !== 'openaiCompatible' || httpOrigin(provider.baseUrl))
        )
      )
    })
    .map((model) => ({
      id: model.id,
      name: `${modelLabel(model)} · ${providerName(model.providerId)}`,
    }))
)

const taskModelOptions = computed(() => [
  { id: '', name: t('settings.taskModelNone') },
  ...modelOptions.value,
])

function providerLabel(provider: LlmProvider) {
  return provider.name?.trim() || provider.baseUrl?.trim() || provider.id
}
function providerName(id: string) {
  const provider = llm.value.providers.find((item) => item.id === id)
  return provider ? providerLabel(provider) : id
}
function hasKey(providerId: string) {
  return Object.hasOwn(secretsStore.secrets, llmSecretId(providerId))
}
onMounted(() => {
  secretsStore.refreshSecrets().catch((error: unknown) => {
    toastError(error, 'settings.keySaveFailed')
  })
})
</script>

<style scoped>
.model-mode-switch {
  display: flex;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--app-border-subtle);
}

.single-model-field {
  padding: var(--space-md) var(--space-lg);
}
</style>
