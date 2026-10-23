<template>
  <div class="settings-stack">
    <SettingsSection :title="t('settings.chatAttachments')">
      <FieldRow
        :label="t('settings.chatImageQuality')"
        :hint="t('settings.chatImageQualityHint')"
        vertical
      >
        <FieldSelect
          :model-value="userConfig.chat.imageQuality || 'balanced'"
          :options="[
            { id: 'economy', name: t('settings.imageQualityEconomy') },
            { id: 'balanced', name: t('settings.imageQualityBalanced') },
            { id: 'original', name: t('settings.imageQualityOriginal') },
          ]"
          @update:model-value="
            userConfig.chat.imageQuality =
              $event as UserConfig['chat']['imageQuality']
          "
        />
      </FieldRow>
    </SettingsSection>
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

    <SettingsSection
      :title="t('settings.modelsForFeatures')"
      :description="t('settings.aiModelUsageHint')"
    >
      <FieldRow
        v-for="task in LLM_TASKS"
        :key="task"
        :label="t(TASK_LABEL_KEYS[task])"
        vertical
      >
        <div class="flex flex-col gap-2 w-full">
          <div
            v-for="(modelId, index) in llm.tasks[task].modelChain"
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
              :model-value="modelId"
              :options="modelOptions"
              @update:model-value="
                llm.tasks[task].modelChain[index] = String($event)
              "
            />
            <IconButton
              size="sm"
              variant="ghost"
              icon="mdi:close"
              :label="t('settings.removeFallback')"
              @click="llm.tasks[task].modelChain.splice(index, 1)"
            />
          </div>
          <div>
            <Button
              size="xs"
              variant="ghost"
              icon="mdi:plus"
              :disabled="!nextFallback(task)"
              @click="addFallback(task)"
            >
              {{
                llm.tasks[task].modelChain.length
                  ? t('settings.addFallback')
                  : t('settings.addPrimaryModel')
              }}
            </Button>
          </div>
        </div>
      </FieldRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.aiRules')">
      <FieldRow :label="t('settings.chatRules')" vertical>
        <FieldTextArea v-model="llm.tasks.chat.rule" />
      </FieldRow>
      <FieldRow :label="t('settings.textCorrection')" vertical>
        <FieldTextArea v-model="llm.tasks.correction.rule" />
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
import FieldTextArea from '../common/FieldTextArea.vue'
import IconButton from '../common/IconButton.vue'
import LlmConnectionCard from './LlmConnectionCard.vue'
import SecretStorageNotice from './SecretStorageNotice.vue'
import SettingsSection from './SettingsSection.vue'
import {
  LLM_TASKS,
  type LlmProvider,
  type UserConfig,
  llmSecretId,
} from '@tyco/shared'

const TASK_LABEL_KEYS = {
  chat: 'settings.chat',
  translation: 'action.translationMenu',
  voiceCorrection: 'settings.voiceTextCorrection',
  correction: 'settings.textCorrection',
  aiTask: 'settings.tasksTab',
} as const

const { t } = useI18n()
const { draft: userConfig, operations } = useSettingsContext()
const llm = computed(() => userConfig.value.llm)
const { toastKey, toastText } = useToast()
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
  getUsableModelIds: () => modelOptions.value.map((option) => option.id),
  setSecret: (id, value, origins) => secretsStore.setSecret(id, value, origins),
  removeSecret: (id) => secretsStore.removeSecret(id),
  checkConnection: checkLlmConnection,
  notifyKeyError: (error) =>
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error'),
  notifyInvalidUrl: () => toastKey('settings.invalidBaseUrl', 'error'),
  formatConnectionError: (error) =>
    `${t('settings.connectionFailed')}: ${String(error)}`,
  providerRemoved: (id) => void operations.finishProviderRemoval(id),
})
const { addProvider, removeProviderById, nextFallback, addFallback, dispose } =
  settings
onBeforeUnmount(dispose)
const pendingProviderId = ref<string | null>(null)
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
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  })
})
</script>

<style scoped>
.assignment-label {
  font-size: var(--text-caption);
}
.assignment-row {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-sm);
}
@container (max-width: 40rem) {
  .assignment-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .assignment-label {
    grid-column: 1 / -1;
  }
}
</style>
