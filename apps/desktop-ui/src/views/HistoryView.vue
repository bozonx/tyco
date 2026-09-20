<template>
  <ContentPadding>
    <SearchInput
      v-model="searchQuery"
      :placeholder="t('input.historySearchPlaceholder')"
      ref="searchInput"
      class="mb-4 w-full"
    />

    <Tabs
      :tabs="tabs"
      v-model:value="currentTab"
      class="mb-4"
      @update:value="onTabChange"
    />

    <HistoryList
      v-show="currentTab === 0"
      :items="editorItems"
      :searchQuery="searchQuery"
      :textTitle="t('history.placeIntoEditor')"
      @remove-item="removeEditorItem"
      @clear-history="clearEditorHistory()"
      @text-click="toEditor"
    />

    <HistoryList
      v-show="currentTab === 1"
      :items="transformItems"
      :searchQuery="searchQuery"
      :textTitle="t('history.placeIntoEditor')"
      @remove-item="removeTransformItem"
      @clear-history="clearTransformHistory()"
      @text-click="toEditor"
    />

    <HistoryList
      v-show="currentTab === 2"
      :items="chatItems"
      :searchQuery="searchQuery"
      :textTitle="t('history.view')"
      @remove-item="removeChatItem"
      @clear-history="clearChatHistory()"
      @text-click="toChat"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { useChatStore } from '../stores/chat'
import { useHistoryStore } from '../stores/history'
import { useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'

const toast = useToast()
const { t } = useI18n()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()
const historyStore = useHistoryStore()
const routeParams = useRouteParams()
const currentTab = ref(0)
const tabs = computed(() => [
  { text: t('history.inputTab'), key: 0 },
  { text: t('history.transformTab'), key: 1 },
  { text: t('history.chatTab'), key: 2 },
])

const searchQuery = ref<string>('')
const searchInput = ref<HTMLInputElement | null>(null)
const editorItems = computed(() =>
  historyStore.editorHistory.map((item: string, index: number) => ({
    id: index,
    value: item,
  }))
)
const transformItems = computed(() =>
  historyStore.transformHistory.map((item: string, index: number) => ({
    id: index,
    value: item,
  }))
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
  await historyStore.loadTransformHistory()
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

const clearTransformHistory = async () => {
  await historyStore.clearTransformHistory()
  toast.toast(t('history.transformsCleared'), 'success')
}

const removeEditorItem = async (item: {
  id: string | number
  value: string
}) => {
  await historyStore.removeFromEditorHistory(item.value)
  toast.toast(t('history.inputRemoved'), 'success')
}

const removeTransformItem = async (item: {
  id: string | number
  value: string
}) => {
  await historyStore.removeFromTransformHistory(item.value)
  toast.toast(t('history.transformsRemoved'), 'success')
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
