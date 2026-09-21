<template>
  <div class="history-page">
    <div class="history-header">
      <SearchInput
        v-model="searchQuery"
        :placeholder="t('input.historySearchPlaceholder')"
        ref="searchInput"
      />
      <div class="history-filters">
        <Tabs
          :tabs="tabs"
          v-model:value="currentTab"
          variant="segmented"
          @update:value="onTabChange"
        />
        <SegmentedControl
          v-if="currentTab === TEXTS_TAB"
          v-model:value="editorFilter"
          :label="t('history.filterLabel')"
          :options="editorFilterOptions"
        />
      </div>
    </div>

    <HistoryList
      v-show="currentTab === TEXTS_TAB"
      :items="editorItems"
      :searchQuery="searchQuery"
      :openTitle="t('history.placeIntoEditor')"
      :actions="editorActions"
      :emptyHint="t('history.emptyHint')"
      :active="currentTab === TEXTS_TAB && !modalOpen"
      :totalCount="historyStore.editorHistory.length"
      @open="toEditor"
      @action="onEditorAction"
      @clear="clearEditorHistory"
    >
      <template #notice>
        <div v-if="editorLoadError" class="history-notice is-error">
          <Icon icon="mdi:alert-circle-outline" height="16" />
          <span>{{ t('history.loadFailed') }}</span>
          <Button xs ghost icon="mdi:reload" @click="loadEditorHistory">
            {{ t('history.retry') }}
          </Button>
        </div>
        <div v-if="removedItem" class="history-notice">
          <Icon icon="mdi:trash-can-outline" height="16" />
          <span>{{ t('history.itemRemoved') }}</span>
          <Button xs ghost icon="mdi:undo" @click="undoRemove">
            {{ t('history.undo') }}
          </Button>
        </div>
        <div v-if="editorHistoryDisabled" class="history-notice">
          <Icon icon="mdi:information-outline" height="16" />
          <span>{{ t('history.textsDisabled') }}</span>
        </div>
      </template>
    </HistoryList>

    <HistoryList
      v-show="currentTab === CHATS_TAB"
      :items="chatItems"
      :searchQuery="searchQuery"
      :openTitle="t('history.view')"
      :actions="chatActions"
      :active="currentTab === CHATS_TAB && !modalOpen"
      :totalCount="historyStore.chatHistory.length"
      @open="toChat"
      @action="onChatAction"
      @clear="clearChatHistory"
    >
      <template #notice>
        <div v-if="chatLoadError" class="history-notice is-error">
          <Icon icon="mdi:alert-circle-outline" height="16" />
          <span>{{ t('history.loadFailed') }}</span>
          <Button xs ghost icon="mdi:reload" @click="loadChatHistory">
            {{ t('history.retry') }}
          </Button>
        </div>
        <div v-if="removedChat" class="history-notice">
          <Icon icon="mdi:trash-can-outline" height="16" />
          <span>{{ t('history.itemRemoved') }}</span>
          <Button xs ghost icon="mdi:undo" @click="undoRemoveChat">
            {{ t('history.undo') }}
          </Button>
        </div>
        <div v-if="chatHistoryDisabled" class="history-notice">
          <Icon icon="mdi:information-outline" height="16" />
          <span>{{ t('history.chatsDisabled') }}</span>
        </div>
      </template>
    </HistoryList>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type {
  HistoryListAction,
  HistoryListItem,
} from '../components/HistoryList.vue'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { getEditorHistoryMeta } from '../lib/history/editor-history-meta'
import {
  type EditorHistoryFilter,
  filterEditorHistory,
  parseHistoryTime,
} from '../lib/history/history-list'
import { useActionMenuStore } from '../stores/actionMenu'
import { useChatStore } from '../stores/chat'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'
import { Icon } from '@iconify/vue'
import type { ChatHistoryItem, EditorHistoryItem } from '@tyco/shared'

const TEXTS_TAB = 0
const CHATS_TAB = 1
const UNDO_TIMEOUT_MS = 8000

const toast = useToast()
const { t } = useI18n()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const actionMenuStore = useActionMenuStore()
const routeParams = useRouteParams()
const currentTab = ref(TEXTS_TAB)
const editorFilter = ref<EditorHistoryFilter>('all')
const removedItem = ref<EditorHistoryItem | null>(null)
const removedChat = ref<ChatHistoryItem | null>(null)
const editorLoadError = ref(false)
const chatLoadError = ref(false)
let undoTimer: ReturnType<typeof setTimeout> | undefined
let chatUndoTimer: ReturnType<typeof setTimeout> | undefined

const tabs = computed(() => [
  {
    text: t('history.inputTab'),
    key: TEXTS_TAB,
    icon: 'mdi:text-box-outline',
    badge: historyStore.editorHistory.length,
  },
  {
    text: t('history.chatTab'),
    key: CHATS_TAB,
    icon: 'mdi:chat-outline',
    badge: historyStore.chatHistory.length,
  },
])

const editorFilterOptions = computed(() => [
  { id: 'all' as const, name: t('history.filterAll') },
  { id: 'output' as const, name: t('history.filterOutput') },
  { id: 'draft' as const, name: t('history.filterDraft') },
  { id: 'source' as const, name: t('history.filterSource') },
])

const modalOpen = computed(
  () =>
    menuModalsStore.currentModal !== MenuModals.NONE ||
    !!menuModalsStore.pendingModal
)

const isLimitZero = (value: unknown) => String(value ?? '').trim() === '0'
const editorHistoryDisabled = computed(() =>
  isLimitZero(ipcStore.params.userConfig?.editorHistoryMaxItems)
)
const chatHistoryDisabled = computed(() =>
  isLimitZero(ipcStore.params.userConfig?.chatHistoryMaxItems)
)

const searchQuery = ref<string>('')
const searchInput = ref<HTMLInputElement | null>(null)

const editorById = computed(
  () => new Map(historyStore.editorHistory.map((item) => [item.id, item]))
)

const editorItems = computed<HistoryListItem[]>(() =>
  filterEditorHistory(historyStore.editorHistory, editorFilter.value).map(
    (item) => {
      const meta = getEditorHistoryMeta(item)

      return {
        id: item.id,
        value: item.text,
        meta: { icon: meta.icon, label: t(meta.labelKey) },
        searchText: t(meta.labelKey),
        time: item.createdAt,
      }
    }
  )
)

const chatItems = computed<HistoryListItem[]>(() =>
  historyStore.chatHistory.map((item) => ({
    id: item.id,
    value: item.description,
    searchText: t('history.chatTab'),
    time: parseHistoryTime(item.lastMsgDate),
  }))
)

const editorActions = computed<HistoryListAction[]>(() => [
  {
    id: 'compare',
    icon: 'mdi:compare-horizontal',
    title: t('history.compare'),
    isVisible: (item) => !!editorById.value.get(item.id)?.result,
  },
  ...(ipcStore.params.windowId
    ? [
        {
          id: 'insert',
          icon: 'mdi:keyboard-outline',
          title: t('action.insertIntoWindow'),
          keys: 'Ctrl+Enter',
        },
      ]
    : []),
  {
    id: 'copy',
    icon: 'mdi:content-copy',
    title: t('action.copyToClipboard'),
    keys: 'Shift+Enter',
  },
  {
    id: 'remove',
    icon: 'mdi:trash-can-outline',
    title: t('history.removeItem'),
    keys: 'Shift+Delete',
    danger: true,
  },
])

const chatActions = computed<HistoryListAction[]>(() => [
  {
    id: 'remove',
    icon: 'mdi:trash-can-outline',
    title: t('history.removeItem'),
    keys: 'Shift+Delete',
    danger: true,
  },
])

onMounted(() => {
  searchInput.value?.focus()
  void loadEditorHistory()
  void loadChatHistory()
})

onUnmounted(() => {
  clearTimeout(undoTimer)
  clearTimeout(chatUndoTimer)
})

navPanelStore.resetNavParams({})

const onTabChange = () => {
  searchInput.value?.focus()
}

const loadEditorHistory = async () => {
  try {
    await historyStore.loadEditorHistory()
    editorLoadError.value = false
  } catch {
    editorLoadError.value = true
  }
}

const loadChatHistory = async () => {
  try {
    await historyStore.loadChatHistory()
    chatLoadError.value = false
  } catch {
    chatLoadError.value = true
  }
}

const reportOperationError = () => {
  toast.toast(t('history.operationFailed'), 'error')
}

const clearEditorHistory = async () => {
  hideUndo()
  try {
    await historyStore.clearEditorHistory()
    toast.toast(t('history.inputCleared'), 'success')
  } catch {
    reportOperationError()
  }
}

const hideUndo = () => {
  clearTimeout(undoTimer)
  removedItem.value = null
}

const removeEditorItem = async (item: HistoryListItem) => {
  let removed: EditorHistoryItem | null

  try {
    removed = await historyStore.removeFromEditorHistory(item.id)
  } catch {
    reportOperationError()
    return
  }

  if (!removed) return

  clearTimeout(undoTimer)
  removedItem.value = removed
  undoTimer = setTimeout(hideUndo, UNDO_TIMEOUT_MS)
}

const undoRemove = async () => {
  const item = removedItem.value

  hideUndo()

  if (!item) return

  try {
    await historyStore.restoreEditorItem(item)
  } catch {
    reportOperationError()
  }
}

const onEditorAction = async (actionId: string, item: HistoryListItem) => {
  const [insertAction, copyAction] = actionMenuStore.getDefaultActions()

  switch (actionId) {
    case 'compare': {
      const result = editorById.value.get(item.id)?.result

      if (result) {
        menuModalsStore.nextModal(MenuModals.DIFF, {
          oldText: item.value,
          newText: result,
        })
      }
      break
    }
    case 'insert':
      await insertAction?.action(item.value)
      break
    case 'copy':
      await copyAction?.action(item.value)
      break
    case 'remove':
      await removeEditorItem(item)
      break
  }
}

const clearChatHistory = async () => {
  hideChatUndo()
  try {
    await historyStore.clearChatHistory()
    toast.toast(t('history.chatsCleared'), 'success')
  } catch {
    reportOperationError()
  }
}

const hideChatUndo = () => {
  clearTimeout(chatUndoTimer)
  removedChat.value = null
}

const undoRemoveChat = async () => {
  const item = removedChat.value

  hideChatUndo()
  if (!item) return

  try {
    await historyStore.restoreChatItem(item)
  } catch {
    reportOperationError()
  }
}

const onChatAction = async (actionId: string, item: HistoryListItem) => {
  if (actionId !== 'remove') return

  try {
    const removed = await historyStore.removeFromChatHistory(item.id)

    if (!removed) return
    clearTimeout(chatUndoTimer)
    removedChat.value = removed
    chatUndoTimer = setTimeout(hideChatUndo, UNDO_TIMEOUT_MS)
  } catch {
    reportOperationError()
  }
}

const toEditor = (item: HistoryListItem) => {
  routeParams.toEditor(item.value)
}

const toChat = async (item: HistoryListItem) => {
  await chatStore.openChat(item.id)
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

.history-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.history-notice {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
  padding: var(--space-xs) var(--space-md);
  font-size: 0.8125rem;
  color: var(--app-text-muted);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
}

.history-notice :deep(.btn) {
  margin-left: auto;
}

.history-notice.is-error {
  color: var(--color-error);
  border-color: color-mix(in srgb, var(--color-error) 35%, var(--app-border));
}
</style>
