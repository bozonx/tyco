<template>
  <SettingsSection
    :title="t('settings.workspaceHistory.title')"
    :info="t('settings.workspaceHistory.hint')"
  >
    <FieldRow
      :label="t('settings.chatHistoryEnabled')"
      :info="t('settings.workspaceHistory.syncedHint')"
      inline
    >
      <FieldSelect
        size="sm"
        class="w-56 shrink-0"
        :model-value="savingChoice(vault.chatHistory)"
        :options="savingOptions"
        data-testid="workspace-history-saving"
        @update:model-value="setSaving"
      />
    </FieldRow>

    <FieldRow
      v-if="isSaving"
      :label="t('settings.chatHistoryRetentionDays')"
      :info="t('settings.chatHistoryRetentionDaysHint')"
      inline
    >
      <FieldSelect
        size="sm"
        class="w-56 shrink-0"
        :model-value="retentionChoice(vault.chatHistory)"
        :options="retentionOptions"
        data-testid="workspace-history-retention"
        @update:model-value="setRetention"
      />
    </FieldRow>

    <SettingsHistoryClear
      :label="t('settings.deleteAllChats')"
      :count-hint="t('settings.chatCount', { count: chatCount })"
      :confirm-title="t('history.clearConfirmTitle')"
      :confirm-message="t('settings.workspaceHistory.clearConfirm')"
      :clear="clearChats"
    />

    <ConfirmModal
      :open="pendingHistory !== null"
      :title="t('settings.historyDeleteConfirmTitle')"
      :message="pendingMessage"
      :confirm-text="t('common.delete')"
      danger
      @confirm="confirmPending"
      @cancel="pendingHistory = null"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import {
  WORKSPACE_DEFAULT,
  type WorkspaceSavingChoice,
  isDefaultSaving,
  isWorkspaceSaving,
  retentionChoice,
  savingChoice,
  withRetention,
  withSaving,
  workspaceRetentionDays,
} from '../../lib/ai-profiles/workspace-history'
import { chatHistoryRetentionChoices } from '../../lib/chat/chat-history-settings'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import { toHtmlLang } from '../../lib/locale/language'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsHistoryClear from './SettingsHistoryClear.vue'
import SettingsSection from './SettingsSection.vue'
import type { VaultChatHistory, VaultInfo } from '@tyco/shared'

/** How the chats of the profiles of one workspace are kept */
const props = defineProps<{ vault: VaultInfo }>()

const { t } = useI18n()
const { toastError } = useToast()
const { draft, effectiveAppLanguage } = useSettingsContext()
const store = useAiProfilesStore()

const defaults = computed(() => draft.value.aiProfiles.chatHistory)
const isSaving = computed(() =>
  isWorkspaceSaving(props.vault.chatHistory, defaults.value)
)

const periodName = (days: number) =>
  historyRetentionOptions(
    [days],
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.chatHistoryRetentionNever')
  )[0]!.name

const savingOptions = computed(() => [
  {
    id: WORKSPACE_DEFAULT,
    name: t('settings.workspaceHistory.byDefault', {
      value: isDefaultSaving(defaults.value)
        ? t('settings.workspaceHistory.saved')
        : t('settings.workspaceHistory.notSaved'),
    }),
  },
  { id: 'disk', name: t('settings.workspaceHistory.saved') },
  { id: 'off', name: t('settings.workspaceHistory.notSaved') },
])

const retentionOptions = computed(() => [
  {
    id: WORKSPACE_DEFAULT,
    name: t('settings.workspaceHistory.byDefault', {
      value: periodName(defaults.value.retentionDays ?? 0),
    }),
  },
  ...chatHistoryRetentionChoices(props.vault.chatHistory.retentionDays).map(
    (days) => ({ id: String(days), name: periodName(days) })
  ),
])

async function save(history: VaultChatHistory) {
  try {
    await store.setVaultChatHistory(props.vault.vaultId, history)
  } catch (error) {
    toastError(error)
  }
}

const SAVING_CHOICES: readonly WorkspaceSavingChoice[] = [
  WORKSPACE_DEFAULT,
  'disk',
  'off',
]

function setSaving(value: string | number | undefined) {
  const choice = SAVING_CHOICES.find((item) => item === value)
  if (choice) void save(withSaving(props.vault.chatHistory, choice))
}

/** A retention change that removes chats, waiting for confirmation */
const pendingHistory = ref<VaultChatHistory | null>(null)
const pendingMessage = computed(() =>
  pendingHistory.value
    ? t('settings.chatHistoryRetentionConfirm', {
        period: periodName(
          workspaceRetentionDays(pendingHistory.value, defaults.value)
        ),
      })
    : ''
)

function setRetention(value: string | number | undefined) {
  if (value === undefined) return
  const change = withRetention(
    props.vault.chatHistory,
    defaults.value,
    String(value)
  )
  if (!change) return
  if (change.isStricter) pendingHistory.value = change.history
  else void save(change.history)
}

function confirmPending() {
  const history = pendingHistory.value
  pendingHistory.value = null
  if (history) void save(history)
}

const chatCount = ref(0)
let countRequest = 0
async function refreshCount() {
  const request = ++countRequest
  try {
    const count = await store.countVaultChats(props.vault.vaultId)
    if (request === countRequest) chatCount.value = count
  } catch {
    // the count stays as last read
  }
}
watch(
  () => [props.vault.vaultId, store.profiles.map(({ id }) => id).join('\n')],
  () => void refreshCount(),
  { immediate: true }
)

async function clearChats() {
  try {
    await store.clearVaultChats(props.vault.vaultId)
  } finally {
    void refreshCount()
  }
}
</script>
