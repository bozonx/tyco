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
      <FieldRow :label="t('settings.allFeaturesModel')">
        <FieldSelect
          :model-value="commonModelId"
          :options="commonModelOptions"
          @update:model-value="setAllTasksModel(String($event ?? ''))"
        />
      </FieldRow>

      <div class="advanced-toggle">
        <DisclosureHeader
          density="compact"
          icon="mdi:tune-variant"
          icon-size="md"
          :expanded="isCustomizingTasks"
          :controls="customTasksId"
          :title="
            isCustomizingTasks
              ? t('settings.hidePerTaskSettings')
              : t('settings.customizePerTask')
          "
          @toggle="isCustomizingTasks = !isCustomizingTasks"
        />
      </div>

      <div
        v-if="isCustomizingTasks"
        :id="customTasksId"
        class="per-task-fields"
      >
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
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'

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
import DisclosureHeader from '../common/DisclosureHeader.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import LlmConnectionCard from './LlmConnectionCard.vue'
import SecretStorageNotice from './SecretStorageNotice.vue'
import SettingsSection from './SettingsSection.vue'
import {
  LLM_TASKS,
  type LlmImageQuality,
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
const customTasksId = useId()

const areAllTaskModelsSame = computed(() => {
  const modelIds = LLM_TASKS.map((task) => llm.value.tasks[task]?.modelId ?? '')
  return modelIds.every((id) => id === modelIds[0])
})

const commonModelId = computed(() => {
  if (areAllTaskModelsSame.value) {
    return llm.value.tasks[LLM_TASKS[0]]?.modelId ?? ''
  }
  return '__custom__'
})

const isCustomizingTasks = ref(!areAllTaskModelsSame.value)

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
function setAllTasksModel(modelId: string) {
  if (modelId === '__custom__') return
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

const commonModelOptions = computed(() => {
  const options = [...taskModelOptions.value]
  if (!areAllTaskModelsSame.value) {
    options.unshift({ id: '__custom__', name: t('settings.mixedTaskModels') })
  }
  return options
})

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
.advanced-toggle {
  display: flex;
  padding: var(--space-xs) var(--space-lg);
  font-size: var(--text-control);
  color: var(--app-text-muted);
  border-top: 1px solid var(--app-border-subtle);
}

.per-task-fields {
  border-top: 1px solid var(--app-border-subtle);
}
</style>
