<template>
  <aside class="chat-sidebar">
    <div class="sidebar-header">
      <Button
        class="flex-1"
        sm
        icon="mdi:plus"
        :disabled="chatStore.isGenerating"
        @click="startChat"
      >
        {{ t('chat.newChat') }}
      </Button>
      <Button
        sm
        ghost
        square
        :active="isSearchOpen"
        :title="t('chat.searchChats')"
        @click="toggleSearch"
      >
        <Icon icon="mdi:magnify" height="18" />
      </Button>
      <Button
        sm
        ghost
        square
        :title="t('chat.collapseSidebar')"
        @click="emit('collapse')"
      >
        <Icon icon="mdi:dock-left" height="18" />
      </Button>
    </div>

    <div v-if="removedChat" class="sidebar-notice">
      <Icon icon="mdi:trash-can-outline" height="15" class="shrink-0" />
      <span class="truncate flex-1">{{ t('history.itemRemoved') }}</span>
      <Button xs ghost icon="mdi:undo" @click="undoRemoveChat">
        {{ t('history.undo') }}
      </Button>
    </div>

    <SearchInput
      v-if="isSearchOpen"
      ref="searchInputRef"
      v-model="query"
      class="sidebar-search"
      :placeholder="t('chat.searchChats')"
      @keydown.esc="closeSearch"
    />

    <div class="chat-list-scroll">
      <div v-if="groups.length === 0" class="chat-list-empty">
        {{ query ? t('history.nothingFound') : t('history.empty') }}
      </div>
      <section v-for="group in groups" :key="group.key" class="chat-group">
        <h2>{{ t(`chat.group.${group.key}`) }}</h2>
        <ul class="chat-list">
          <li v-for="item in group.items" :key="item.id" class="chat-list-row">
            <form
              v-if="renamingId === item.id"
              class="rename-form"
              @submit.prevent="finishRename(item)"
            >
              <input
                ref="renameInputs"
                v-model="renameValue"
                maxlength="120"
                @keydown.esc="cancelRename"
                @blur="finishRename(item)"
              />
            </form>
            <template v-else>
              <button
                type="button"
                class="chat-list-item"
                :disabled="chatStore.isGenerating"
                :class="{
                  'is-active': chatStore.newChatParams?.id === item.id,
                }"
                :title="item.description"
                @click="openChat(item.id)"
              >
                <Icon icon="mdi:message-outline" height="15" class="shrink-0" />
                <span class="truncate">{{
                  item.description || t('common.empty')
                }}</span>
              </button>
              <DropdownMenu
                xs
                square
                hide-chevron
                icon="mdi:dots-horizontal"
                class="row-menu"
                :title="t('common.more')"
                align="right"
                :items="getRowMenuItems(item)"
              />
            </template>
          </li>
        </ul>
      </section>
    </div>

    <div
      v-if="historyStore.chatHistory.length || chatHistoryDisabled"
      class="sidebar-footer"
    >
      <p v-if="chatHistoryDisabled" class="history-disabled-hint">
        {{ t('history.chatsDisabled') }}
      </p>
      <Button
        v-if="historyStore.chatHistory.length"
        xs
        ghost
        icon="mdi:trash-can-outline"
        class="sidebar-clear-btn"
        @click="showClearAllModal = true"
      >
        {{ t('history.clear') }}
      </Button>
    </div>

    <ConfirmModal
      :open="showClearAllModal"
      :title="t('history.clearConfirmTitle')"
      :message="
        t('history.clearConfirmDialog', {
          count: historyStore.chatHistory.length,
        })
      "
      :confirm-text="t('history.clearConfirmButton')"
      danger
      @confirm="confirmClearAll"
      @cancel="showClearAllModal = false"
    />

    <ConfirmModal
      :open="Boolean(chatToDelete)"
      :title="t('chat.deleteConfirmTitle')"
      :message="t('chat.deleteConfirmMessage')"
      :confirm-text="t('common.delete')"
      danger
      @confirm="confirmDeleteChat"
      @cancel="chatToDelete = null"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import { formatChatToMarkdown } from '../../lib/chat/chat-export'
import {
  filterChatHistory,
  groupChatHistory,
} from '../../lib/chat/chat-history-list'
import { isChatHistoryEnabled } from '../../lib/chat/chat-history-settings'
import { useChatStore } from '../../stores/chat'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import SearchInput from '../common/SearchInput.vue'
import { Icon } from '@iconify/vue'
import type { ChatHistoryItem } from '@tyco/shared'

const emit = defineEmits<{ (e: 'collapse'): void; (e: 'navigate'): void }>()
const { t } = useI18n()
const { toast } = useToast()
const chatStore = useChatStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const isSearchOpen = ref(false)
const searchInputRef = ref<{ focus(): void } | null>(null)
const query = ref('')

async function toggleSearch() {
  isSearchOpen.value = !isSearchOpen.value
  if (isSearchOpen.value) {
    await nextTick()
    searchInputRef.value?.focus?.()
  } else {
    query.value = ''
  }
}

function closeSearch() {
  isSearchOpen.value = false
  query.value = ''
}
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputs = ref<HTMLInputElement[]>([])
const showClearAllModal = ref(false)
const chatToDelete = ref<string | null>(null)
const removedChat = ref<ChatHistoryItem | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | undefined

const chatHistoryDisabled = computed(
  () => !isChatHistoryEnabled(ipcStore.params.userConfig)
)

/** Chats whose messages match the query, found in storage */
const matchedIds = ref<Set<string> | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchRun = 0

watch(query, (value) => {
  clearTimeout(searchTimer)
  matchedIds.value = null
  const run = ++searchRun
  if (!value.trim()) return
  searchTimer = setTimeout(async () => {
    try {
      const ids = await historyStore.searchChats(value)
      if (run === searchRun) matchedIds.value = new Set(ids)
    } catch {
      // the titles are still matched
    }
  }, 200)
})

const groups = computed(() =>
  groupChatHistory(
    filterChatHistory(historyStore.chatHistory, query.value, matchedIds.value)
  )
)

function getRowMenuItems(item: ChatHistoryItem): DropdownMenuItem[] {
  return [
    {
      label: t('chat.renameChat'),
      icon: 'mdi:pencil-outline',
      action: () => beginRename(item),
    },
    {
      label: t('chat.copyMarkdown'),
      icon: 'mdi:content-copy',
      action: () => copyChatMarkdown(item.id),
    },
    {
      label: t('chat.deleteChat'),
      icon: 'mdi:trash-can-outline',
      danger: true,
      action: () => {
        chatToDelete.value = item.id
      },
    },
  ]
}

async function copyChatMarkdown(id: string) {
  let targetChat = await historyStore.loadChat(id)
  if (!targetChat && chatStore.newChatParams?.id === id) {
    targetChat = {
      id,
      description: chatStore.newChatParams.title || '',
      lastMsgDate: '',
      messages: chatStore.messages,
    }
  }
  if (targetChat) {
    const md = formatChatToMarkdown(targetChat.messages, {
      title: targetChat.description,
    })
    await navigator.clipboard.writeText(md)
    toast(t('chat.markdownCopied'), 'info')
  }
}

async function startChat() {
  await chatStore.startNewChat()
  emit('navigate')
}

async function openChat(id: string) {
  await chatStore.openChat(id)
  emit('navigate')
}

async function beginRename(item: ChatHistoryItem) {
  renamingId.value = item.id
  renameValue.value = item.description
  await nextTick()
  renameInputs.value.at(-1)?.select()
}

function cancelRename() {
  renamingId.value = null
}

async function finishRename(item: ChatHistoryItem) {
  if (renamingId.value !== item.id) return
  const description = renameValue.value.trim()
  renamingId.value = null
  if (!description || description === item.description) return
  try {
    await historyStore.renameChat(item.id, description)
    chatStore.setTitle(item.id, description)
  } catch {
    toast(t('history.operationFailed'), 'error')
  }
}

async function confirmDeleteChat() {
  const id = chatToDelete.value
  chatToDelete.value = null
  if (!id) return
  await removeChat(id)
}

async function removeChat(id: string) {
  clearTimeout(undoTimer)
  // leave the chat first, or its pending write would bring it back
  if (chatStore.newChatParams.id === id) {
    chatStore.abandonChat()
    await chatStore.whenSaved()
  }
  const item = historyStore.chatHistory.find((c) => c.id === id)
  const removed = await historyStore.removeFromChatHistory(id)
  if (removed || item) {
    removedChat.value = removed || item || null
    undoTimer = setTimeout(() => {
      removedChat.value = null
    }, 8000)
  }
}

async function undoRemoveChat() {
  clearTimeout(undoTimer)
  const item = removedChat.value
  removedChat.value = null
  if (item) {
    await historyStore.restoreChatItem(item)
  }
}

async function confirmClearAll() {
  showClearAllModal.value = false
  await clearAllChats()
}

async function clearAllChats() {
  if (chatStore.messages.length) {
    chatStore.abandonChat()
    await chatStore.whenSaved()
  }
  await historyStore.clearChatHistory()
}

onUnmounted(() => {
  clearTimeout(undoTimer)
  clearTimeout(searchTimer)
})
</script>

<style scoped>
.chat-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 16rem;
  flex-shrink: 0;
  height: 100%;
  padding: var(--space-md);
  border-right: 1px solid var(--app-border-subtle);
  background: var(--app-surface-raised);
}
.sidebar-header {
  display: flex;
  gap: var(--space-xs);
}
.sidebar-footer {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border-subtle);
}
.sidebar-clear-btn {
  align-self: flex-start;
  color: var(--app-text-faint);
  font-size: 0.75rem;
}
.sidebar-clear-btn:hover {
  color: var(--color-error);
}
.history-disabled-hint {
  margin: 0;
  color: var(--app-text-faint);
  font-size: 0.72rem;
  line-height: 1.3;
}
.sidebar-notice {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.75rem;
  color: var(--app-text-muted);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
}
.sidebar-search :deep(.input) {
  height: 2.25rem;
  border-color: transparent;
  background: var(--app-surface);
  font-size: 0.78rem;
}
.chat-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.chat-group + .chat-group {
  margin-top: var(--space-lg);
}
.chat-group h2 {
  margin: 0 0 var(--space-xs);
  padding: 0 var(--space-sm);
  color: var(--app-text-faint);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.chat-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.chat-list-row {
  position: relative;
  display: flex;
  align-items: center;
}
.chat-list-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  min-width: 0;
  padding: 0.5rem 2rem 0.5rem 0.625rem;
  border-radius: var(--radius-md);
  color: var(--app-text-muted);
  font-size: 0.8125rem;
  text-align: left;
  cursor: pointer;
}
.chat-list-item:hover {
  color: var(--color-base-content);
  background: var(--app-hover);
}
.chat-list-item.is-active {
  color: var(--color-base-content);
  background: var(--app-active);
  font-weight: 500;
}
.row-menu {
  position: absolute;
  right: 0.25rem;
  display: none;
}
.chat-list-row:hover .row-menu,
.row-menu:focus-within {
  display: inline-block;
}
.rename-form {
  width: 100%;
}
.rename-form input {
  width: 100%;
  height: 2rem;
  padding: 0 var(--space-sm);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--app-surface);
  outline: 0;
  font-size: 0.8125rem;
}
.chat-list-empty {
  padding: var(--space-lg) var(--space-sm);
  color: var(--app-text-faint);
  font-size: 0.8125rem;
  text-align: center;
}
</style>
