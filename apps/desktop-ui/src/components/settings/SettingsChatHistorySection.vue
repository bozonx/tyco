<template>
  <SettingsSection :title="t('settings.sectionChatHistory')">
    <FieldRow
      :label="t('settings.chatHistoryEnabled')"
      :info="t('settings.chatHistoryEnabledInfo')"
      inline
    >
      <FieldSwitch
        :model-value="isHistoryChecked"
        @update:model-value="setHistoryEnabled"
      />
    </FieldRow>

    <FieldRow
      v-if="isHistoryChecked"
      :label="t('settings.chatHistoryRetentionDays')"
      :info="t('settings.chatHistoryRetentionDaysHint')"
      inline
    >
      <FieldSelect
        size="sm"
        class="w-44 shrink-0"
        :model-value="history.retentionDays ?? 0"
        :options="retentionOptions"
        @update:model-value="setRetentionDays"
      />
    </FieldRow>

    <FieldRow
      :label="t('history.clear')"
      :hint="t('settings.chatCount', { count: chatCount })"
      inline
    >
      <Button
        size="sm"
        variant="ghost"
        icon="mdi:trash-can-outline"
        @click="showClearModal = true"
      >
        {{ t('settings.deleteAllChats') }}
      </Button>
    </FieldRow>

    <ConfirmModal
      :open="showClearModal"
      :title="t('history.clearConfirmTitle')"
      :message="t('settings.clearChatsConfirmDialog')"
      :confirm-text="t('history.clearConfirmButton')"
      danger
      @confirm="onClear"
      @cancel="showClearModal = false"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, unref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import {
  chatHistoryRetentionChoices,
  isChatHistoryEnabled,
} from '../../lib/chat/chat-history-settings'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import { toHtmlLang } from '../../lib/locale/language'
import { useHistoryStore } from '../../stores/history'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()
const { toastKey } = useToast()
const historyStore = useHistoryStore()

const history = computed(() => userConfig.value.chat.history)

onMounted(() => {
  void historyStore.loadChatHistory?.()
})

const chatCount = computed(() => unref(historyStore.chatHistory)?.length ?? 0)

const showClearModal = ref(false)

async function onClear() {
  showClearModal.value = false
  await historyStore.clearChats()
  toastKey('history.cleared', 'info')
}

const isHistoryChecked = computed(() => isChatHistoryEnabled(userConfig.value))

function setHistoryEnabled(isEnabled: boolean) {
  history.value.storage = isEnabled ? 'disk' : 'off'
}

function setRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return
  if (parsed === 0) delete history.value.retentionDays
  else history.value.retentionDays = parsed
}

const retentionOptions = computed(() =>
  historyRetentionOptions(
    chatHistoryRetentionChoices(history.value.retentionDays),
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.chatHistoryRetentionNever')
  )
)
</script>
