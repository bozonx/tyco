<template>
  <SettingsSection
    :title="t('settings.workspaceHistory.title')"
    :info="t('settings.workspaceHistory.hint')"
  >
    <template #actions>
      <SettingsHistoryClear
        :count="chatCount"
        :label-keys="{
          one: 'settings.deleteAllChats.one',
          few: 'settings.deleteAllChats.few',
          many: 'settings.deleteAllChats.many',
          other: 'settings.deleteAllChats.other',
        }"
        :confirm-title="t('history.clearConfirmTitle')"
        :confirm-message="t('settings.workspaceHistory.clearConfirm')"
        :clear="clearChats"
      />
    </template>
    <FieldRow
      :label="t('settings.chatHistoryKeeping')"
      :info="t('settings.workspaceHistory.syncedHint')"
      inline
    >
      <FieldSelect
        size="sm"
        class="w-44 shrink-0"
        :model-value="historyKeepingChoice(kept)"
        :options="keepingOptions"
        data-testid="workspace-history-keeping"
        @update:model-value="setKeeping"
      />
    </FieldRow>

    <FieldRow
      :label="t('settings.chatQuickRequestsSaved')"
      :info="t('settings.chatQuickRequestsSavedInfo')"
      inline
    >
      <FieldSwitch
        :model-value="vault.chatHistory.isQuickRequestSavingEnabled !== false"
        data-testid="workspace-history-quick-requests"
        @update:model-value="setQuickRequestSaving"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { chatHistoryRetentionChoices } from '../../lib/chat/chat-history-settings'
import { desktopClient } from '../../lib/desktop/client'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import {
  type KeptHistoryConfig,
  applyHistoryKeeping,
  historyKeepingChoice,
  historyKeepingOptions,
} from '../../lib/history/history-settings-model'
import { toHtmlLang } from '../../lib/locale/language'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsHistoryClear from './SettingsHistoryClear.vue'
import SettingsSection from './SettingsSection.vue'
import {
  DESKTOP_EVENTS,
  type VaultChatHistory,
  type VaultInfo,
} from '@tyco/shared'

/**
 * How the chats of the profiles of one workspace are kept. The workspace
 * decides alone; a missing value saves the chats forever
 */
const props = defineProps<{ vault: VaultInfo }>()

const { t } = useI18n()
const { toastError } = useToast()
const { effectiveAppLanguage } = useSettingsContext()
const store = useAiProfilesStore()

const kept = computed<KeptHistoryConfig>(() => ({
  storage: props.vault.chatHistory.storage ?? 'disk',
  retentionDays: props.vault.chatHistory.retentionDays || undefined,
}))

const periodName = (days: number) =>
  historyRetentionOptions(
    [days],
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.editorHistoryRetentionForever')
  )[0]!.name

const keepingOptions = computed(() =>
  historyKeepingOptions(
    chatHistoryRetentionChoices(props.vault.chatHistory.retentionDays),
    {
      session: t('settings.editorHistoryStorageSession'),
      forever: t('settings.editorHistoryRetentionForever'),
      period: periodName,
    }
  )
)

async function save(history: VaultChatHistory) {
  try {
    await store.setVaultChatHistory(props.vault.vaultId, history)
  } catch (error) {
    toastError(error)
  }
}

function setKeeping(value: string | number | undefined) {
  const next = { ...kept.value }
  if (!applyHistoryKeeping(next, value)) return
  const { retentionDays: _days, ...rest } = props.vault.chatHistory
  void save({
    ...rest,
    storage: next.storage,
    ...(next.retentionDays ? { retentionDays: next.retentionDays } : {}),
  })
}

function setQuickRequestSaving(isEnabled: boolean) {
  const { isQuickRequestSavingEnabled: _saving, ...rest } =
    props.vault.chatHistory
  void save(isEnabled ? rest : { ...rest, isQuickRequestSavingEnabled: false })
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

// the count follows the chats of profiles as they are kept or removed
let stopListening: (() => void) | undefined
let isUnmounted = false
void desktopClient
  .listen(DESKTOP_EVENTS.CHATS_CHANGED, (event) => {
    if (event.profileId) void refreshCount()
  })
  .then((unlisten) => {
    if (isUnmounted) unlisten()
    else stopListening = unlisten
  })
  .catch(() => undefined)
onBeforeUnmount(() => {
  isUnmounted = true
  stopListening?.()
})

async function clearChats() {
  try {
    await store.clearVaultChats(props.vault.vaultId)
  } finally {
    void refreshCount()
  }
}
</script>
