<template>
  <SettingsSection :title="t('settings.chatAttachments')">
    <FieldRow
      :label="t('settings.chatImageQuality')"
      :hint="t('settings.chatImageQualityHint')"
      vertical
    >
      <FieldSelect
        :value="imageQuality || 'balanced'"
        :options="[
          { id: 'economy', name: t('settings.imageQualityEconomy') },
          { id: 'balanced', name: t('settings.imageQualityBalanced') },
          { id: 'original', name: t('settings.imageQualityOriginal') },
        ]"
        @update:value="
          emit(
            'update:imageQuality',
            $event as UserConfig['chat']['imageQuality']
          )
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
      <Button size="sm" icon="mdi:plus" @click="addProvider">
        {{ t('settings.addConnection') }}
      </Button>
    </template>

    <div class="flex flex-col gap-3">
      <SecretStorageNotice />
      <LlmConnectionCard
        v-for="provider in llm.providers"
        :key="provider.id"
        :provider="provider"
        :label="providerLabel(provider)"
        :llm="llm"
        :settings="settings"
        :secrets="llmStore.secrets"
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
      :label="t(`settings.${task}`)"
      vertical
    >
      <div class="flex flex-col gap-2 w-full">
        <div
          v-for="(modelId, index) in llm.taskModelChains[task]"
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
            @update:value="llm.taskModelChains[task][index] = String($event)"
          />
          <Button
            size="sm"
            variant="ghost"
            square
            icon="mdi:close"
            :title="t('settings.removeFallback')"
            @click="llm.taskModelChains[task].splice(index, 1)"
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
              llm.taskModelChains[task].length
                ? t('settings.addFallback')
                : t('settings.addPrimaryModel')
            }}
          </Button>
        </div>
      </div>
    </FieldRow>
  </SettingsSection>

  <SettingsSection v-if="aiRules" :title="t('settings.aiRules')">
    <FieldRow :label="t('settings.chatRules')" vertical>
      <FieldTextArea v-model:value="aiRules.chat" />
    </FieldRow>
    <FieldRow :label="t('settings.textCorrection')" vertical>
      <FieldTextArea v-model:value="aiRules.correction" />
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
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { modelLabel } from '../../lib/llm/llm-config'
import { createLlmConnectionChecker } from '../../lib/llm/llm-connection'
import { createLlmSettingsModel } from '../../lib/llm/llm-settings-model'
import { httpOrigin } from '../../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../../lib/net/tauri-net'
import { useLlmStore } from '../../stores/llm'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SettingsSection from '../common/SettingsSection.vue'
import LlmConnectionCard from './LlmConnectionCard.vue'
import SecretStorageNotice from './SecretStorageNotice.vue'
import {
  LLM_TASKS,
  type LlmConfig,
  type LlmProvider,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{
  llm: LlmConfig
  aiRules?: UserConfig['aiRules']
  imageQuality?: UserConfig['chat']['imageQuality']
}>()
const emit = defineEmits<{
  (event: 'providerRemoved', id: string): void
  (
    event: 'update:imageQuality',
    value: UserConfig['chat']['imageQuality']
  ): void
}>()
const { t } = useI18n()
const { toastKey, toastText } = useToast()
const llmStore = useLlmStore()
const checkLlmConnection = createLlmConnectionChecker({
  fetch: createTauriTransport(tauriNetIpc).fetch,
  hasKey,
  getModelId: (providerId) =>
    props.llm.models.find((model) => model.providerId === providerId)
      ?.providerModelId,
})
const settings = createLlmSettingsModel({
  getConfig: () => props.llm,
  getUsableModelIds: () => modelOptions.value.map((option) => option.id),
  setSecret: (id, value, origins) => llmStore.setSecret(id, value, origins),
  removeSecret: (id) => llmStore.removeSecret(id),
  checkConnection: checkLlmConnection,
  notifyKeyError: (error) =>
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error'),
  notifyInvalidUrl: () => toastKey('settings.invalidBaseUrl', 'error'),
  formatConnectionError: (error) =>
    `${t('settings.connectionFailed')}: ${String(error)}`,
  providerRemoved: (id) => emit('providerRemoved', id),
})
const { addProvider, removeProviderById, nextFallback, addFallback, dispose } =
  settings
onBeforeUnmount(dispose)
const pendingProviderId = ref<string | null>(null)
function confirmProviderRemoval() {
  if (pendingProviderId.value) removeProviderById(pendingProviderId.value)
  pendingProviderId.value = null
}

const modelOptions = computed(() =>
  props.llm.models
    .filter((model) => {
      const provider = props.llm.providers.find(
        (item) => item.id === model.providerId
      )
      return (
        Boolean(model.providerModelId.trim()) &&
        Boolean(
          provider &&
          (provider.type !== 'openai-compatible' ||
            httpOrigin(provider.baseUrl))
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
  const provider = props.llm.providers.find((item) => item.id === id)
  return provider ? providerLabel(provider) : id
}
function hasKey(id: string) {
  return Object.hasOwn(llmStore.secrets, id)
}
onMounted(() => {
  llmStore.refreshSecrets().catch((error: unknown) => {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  })
})
</script>

<style scoped>
.assignment-label {
  font-size: var(--text-caption);
}
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
