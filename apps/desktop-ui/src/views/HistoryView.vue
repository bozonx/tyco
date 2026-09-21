<template>
  <div class="history-page">
    <div class="history-header">
      <SearchInput
        v-model="searchQuery"
        :placeholder="t('input.historySearchPlaceholder')"
        ref="searchInput"
      />
      <Tabs
        :tabs="tabs"
        v-model:value="currentTab"
        variant="segmented"
        @update:value="onTabChange"
      />
    </div>

    <HistoryList
      v-show="currentTab === 0"
      :items="editorItems"
      :searchQuery="searchQuery"
      :textTitle="t('history.placeIntoEditor')"
      openIcon="mdi:pencil-outline"
      @remove-item="removeEditorItem"
      @clear-history="clearEditorHistory()"
      @text-click="toEditor"
    />

    <HistoryList
      v-show="currentTab === 1"
      :items="chatItems"
      :searchQuery="searchQuery"
      :textTitle="t('history.view')"
      openIcon="mdi:chat-outline"
      @remove-item="removeChatItem"
      @clear-history="clearChatHistory()"
      @text-click="toChat"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { HistoryListItem } from '../components/HistoryList.vue'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import {
  formatEditorHistoryDate,
  getEditorHistoryMeta,
} from '../lib/history/editor-history-meta'
import { useChatStore } from '../stores/chat'
import { useHistoryStore } from '../stores/history'
import { useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'

const toast = useToast()
const { t, locale } = useI18n()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()
const historyStore = useHistoryStore()
const routeParams = useRouteParams()
const currentTab = ref(0)
const tabs = computed(() => [
  {
    text: t('history.inputTab'),
    key: 0,
    icon: 'mdi:text-box-outline',
    badge: historyStore.editorHistory.length,
  },
  {
    text: t('history.chatTab'),
    key: 1,
    icon: 'mdi:chat-outline',
    badge: historyStore.chatHistory.length,
  },
])

const searchQuery = ref<string>('')
const searchInput = ref<HTMLInputElement | null>(null)
const editorItems = computed<HistoryListItem[]>(() =>
  historyStore.editorHistory.map((item) => {
    const meta = getEditorHistoryMeta(item)

    return {
      id: item.id,
      value: item.text,
      meta: { icon: meta.icon, label: t(meta.labelKey) },
      date: formatEditorHistoryDate(item.createdAt, locale.value),
    }
  })
)
const chatItems = computed(() =>
  historyStore.chatHistory.map((item: { id: string; description: string }) => ({
    id: item.id,
    value: item.description,
  }))
)

onMounted(async () => {
  if (searchInput.value) {
    searchInput.value.focus()
  }

  await historyStore.loadEditorHistory()
  await historyStore.loadChatHistory()
})

navPanelStore.resetNavParams({})

const onTabChange = () => {
  if (searchInput.value) {
    searchInput.value.focus()
  }
}

const clearEditorHistory = async () => {
  await historyStore.clearEditorHistory()
  toast.toast(t('history.inputCleared'), 'success')
}

const removeEditorItem = async (item: HistoryListItem) => {
  await historyStore.removeFromEditorHistory(item.id.toString())
  toast.toast(t('history.inputRemoved'), 'success')
}

const clearChatHistory = async () => {
  await historyStore.clearChatHistory()
  toast.toast(t('history.chatsCleared'), 'success')
}

const removeChatItem = async (item: { id: string | number; value: string }) => {
  await historyStore.removeFromChatHistory(item.id.toString())
  toast.toast(t('history.chatsRemoved'), 'success')
}

const toEditor = (item: { id: string | number; value: string }) => {
  routeParams.toEditor(item.value)
}

const toChat = async (item: { id: string | number; value: string }) => {
  await chatStore.openChat(item.id.toString())
}
</script>

<style scoped>
.history-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  width: 100%;
  max-width: 880px;
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  padding: var(--space-xl) var(--space-xl) 0;
}

.history-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
</style>
