<template>
  <SettingsSection
    :title="t(texts.titleKey)"
    :info="texts.infoKey && t(texts.infoKey)"
  >
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
      :message="t(texts.confirmKey)"
      :confirm-text="t('history.clearConfirmButton')"
      danger
      @confirm="onClear"
      @cancel="showClearModal = false"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, unref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import {
  type ChatHistoryScope,
  chatHistoryConfig,
  chatHistoryRetentionChoices,
} from '../../lib/chat/chat-history-settings'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import { toHtmlLang } from '../../lib/locale/language'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useHistoryStore } from '../../stores/history'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsSection from './SettingsSection.vue'

const props = withDefaults(defineProps<{ scope?: ChatHistoryScope }>(), {
  scope: 'askAi',
})

const TEXTS = {
  askAi: {
    titleKey: 'settings.sectionChatHistory',
    infoKey: '',
    confirmKey: 'settings.clearChatsConfirmDialog',
  },
  profiles: {
    titleKey: 'settings.sectionProfileChatHistory',
    infoKey: 'settings.profileChatHistoryHint',
    confirmKey: 'settings.clearProfileChatsConfirmDialog',
  },
} as const

const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()
const { toastKey } = useToast()

const texts = computed(() => TEXTS[props.scope])
const history = computed(() => chatHistoryConfig(userConfig.value, props.scope))

/** What the chats of the scope are counted and cleared with */
function useScopeChats(scope: ChatHistoryScope) {
  if (scope === 'profiles') {
    const aiProfilesStore = useAiProfilesStore()
    const count = ref(0)
    let countRequest = 0
    const refresh = async () => {
      const request = ++countRequest
      try {
        const total = await aiProfilesStore.countAllProfileChats()
        if (request === countRequest) count.value = total
      } catch {
        // the count stays as last read
      }
    }
    // the profiles are listed once the vault is read
    watch(
      () => aiProfilesStore.profiles.map(({ id }) => id).join('\n'),
      () => void refresh()
    )
    return {
      count,
      load: refresh,
      clear: async () => {
        countRequest += 1
        try {
          await aiProfilesStore.clearAllProfileChats()
        } finally {
          void refresh()
        }
      },
    }
  }
  const historyStore = useHistoryStore()
  return {
    count: computed(() => unref(historyStore.chatHistory)?.length ?? 0),
    load: async () => {
      await historyStore.loadChatHistory?.()
    },
    clear: () => historyStore.clearChats(),
  }
}

const scopeChats = useScopeChats(props.scope)

onMounted(() => {
  void scopeChats.load()
})

const chatCount = computed(() => scopeChats.count.value)

const showClearModal = ref(false)

async function onClear() {
  showClearModal.value = false
  try {
    await scopeChats.clear()
    toastKey('history.cleared', 'info')
  } catch {
    toastKey('history.operationFailed', 'error')
  }
}

const isHistoryChecked = computed(() => history.value.storage !== 'off')

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
