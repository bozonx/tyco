<template>
  <aside class="chat-sidebar">
    <div class="sidebar-header">
      <Button
        class="flex-1"
        size="sm"
        icon="mdi:plus"
        :disabled="chatStore.isGenerating"
        @click="startChat"
      >
        {{ t('chat.newChat') }}
      </Button>
      <IconButton
        size="sm"
        variant="ghost"
        :active="isSearchOpen"
        @click="toggleSearch"
        :label="t('chat.searchChats')"
        icon="mdi:magnify"
      />
      <IconButton
        size="sm"
        variant="ghost"
        @click="emit('collapse')"
        :label="t('chat.collapseSidebar')"
        icon="mdi:dock-left"
      />
    </div>

    <InlineNotice
      v-if="removedChat"
      class="sidebar-notice"
      announcement="polite"
      icon="mdi:trash-can-outline"
      :message="t('history.itemRemoved')"
      appearance="surface"
      density="compact"
    >
      <Button size="xs" variant="ghost" icon="mdi:undo" @click="undoRemoveChat">
        {{ t('history.undo') }}
      </Button>
    </InlineNotice>

    <SearchInput
      v-if="isSearchOpen"
      ref="searchInputRef"
      v-model="query"
      class="sidebar-search"
      size="sm"
      quiet
      :placeholder="t('chat.searchChats')"
      @keydown.esc="closeSearch"
    />

    <div class="chat-list-scroll">
      <StateMessage
        v-if="groups.length === 0"
        class="chat-list-empty"
        :message="query ? t('history.nothingFound') : t('history.empty')"
      />
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
                  'is-active': chatStore.currentChatParams?.id === item.id,
                }"
                :title="item.title"
                @click="openChat(item.id)"
              >
                <Icon icon="mdi:message-outline" height="15" class="shrink-0" />
                <span class="truncate">{{
                  item.title || t('common.empty')
                }}</span>
              </button>
              <DropdownMenu
                size="xs"
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

    <div v-if="chatHistoryDisabled" class="sidebar-footer">
      <p class="history-disabled-hint">
        {{ t('history.chatsDisabled') }}
      </p>
    </div>

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

import { useChatScope } from '../../composables/use-chat-scope'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { formatChatToMarkdown } from '../../lib/chat/chat-export'
import {
  filterChatHistory,
  groupChatHistory,
} from '../../lib/chat/chat-history-list'
import { isChatHistoryEnabled } from '../../lib/chat/chat-history-settings'
import { releaseChatImageUndo } from '../../lib/chat/chat-image-storage'
import { createRemovalUndo } from '../../lib/history/removal-undo'
import { useDesktopStore } from '../../stores/desktop'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SearchInput from '../common/SearchInput.vue'
import StateMessage from '../common/StateMessage.vue'
import type { Chat, ChatSummary } from '@tyco/shared'

const emit = defineEmits<{ (e: 'collapse'): void; (e: 'navigate'): void }>()
const { t } = useI18n()
const { toastKey } = useToast()
const { chat: chatStore } = useChatScope()
/** The chats of the shown chat only: "Ask AI" or one profile */
const history = chatStore.history
const desktopStore = useDesktopStore()

void history
  .loadChatHistory()
  .catch(() => toastKey('history.operationFailed', 'error'))

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
const chatToDelete = ref<string | null>(null)
const removal = createRemovalUndo<Chat>({
  remove: async (id) => {
    const wasOpen = chatStore.currentChatParams.id === id
    if (wasOpen) {
      chatStore.abandonChat()
      await chatStore.whenSaved()
    }
    try {
      return await history.deleteChat(id)
    } catch (error) {
      if (wasOpen) await chatStore.openChat(id, { silent: true })
      throw error
    }
  },
  restore: (item) => history.restoreChatItem(item),
  release: (item) => releaseChatImageUndo(item.id),
  reportError: () => toastKey('history.operationFailed', 'error'),
})
const removedChat = removal.removed
const undoRemoveChat = removal.undo

const chatHistoryDisabled = computed(
  () => !isChatHistoryEnabled(desktopStore.userConfig)
)

/** Chats whose messages match the query, found in storage */
const matchedIds = ref<Set<string> | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchRun = 0

watch(
  [query, () => history.chatHistory],
  ([value]) => {
    clearTimeout(searchTimer)
    matchedIds.value = null
    const run = ++searchRun
    if (!value.trim()) return
    searchTimer = setTimeout(async () => {
      try {
        const ids = await history.searchChats(value)
        if (run === searchRun) matchedIds.value = new Set(ids)
      } catch {
        // the titles are still matched
      }
    }, 200)
  },
  { deep: true }
)

const groups = computed(() =>
  groupChatHistory(
    filterChatHistory(history.chatHistory, query.value, matchedIds.value)
  )
)

function getRowMenuItems(item: ChatSummary): DropdownMenuItem[] {
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
      action: () => {
        chatToDelete.value = item.id
      },
    },
  ]
}

async function copyChatMarkdown(id: string) {
  let targetChat: Chat | null
  // the open chat is newer in memory than in storage
  if (chatStore.currentChatParams?.id === id) {
    targetChat = {
      id,
      title: chatStore.currentChatParams.title || '',
      lastMessageAt: '',
      messages: chatStore.messages,
    }
  } else {
    try {
      targetChat = await history.loadChat(id)
    } catch {
      toastKey('history.operationFailed', 'error')
      return
    }
  }
  if (!targetChat) return
  const md = formatChatToMarkdown(targetChat.messages, {
    title: targetChat.title,
  })
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    toastKey('editor.menu.clipboardUnavailable', 'error')
    return
  }
  toastKey('chat.markdownCopied', 'info')
}

async function startChat() {
  await chatStore.startNewChat()
  emit('navigate')
}

async function openChat(id: string) {
  await chatStore.openChat(id)
  emit('navigate')
}

async function beginRename(item: ChatSummary) {
  renamingId.value = item.id
  renameValue.value = item.title
  await nextTick()
  renameInputs.value.at(-1)?.select()
}

function cancelRename() {
  renamingId.value = null
}

async function finishRename(item: ChatSummary) {
  if (renamingId.value !== item.id) return
  const title = renameValue.value.trim()
  renamingId.value = null
  if (!title || title === item.title) return
  try {
    await chatStore.renameChat(item.id, title)
  } catch {
    // The chat store reports rename failures.
  }
}

async function confirmDeleteChat() {
  const id = chatToDelete.value
  chatToDelete.value = null
  if (!id) return
  await removal.remove(id)
}

onUnmounted(() => {
  void removal.dispose()
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
.history-disabled-hint {
  margin: 0;
  color: var(--app-text-faint);
  font-size: var(--text-caption);
  line-height: 1.3;
}
.sidebar-notice {
  margin-bottom: var(--space-sm);
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
  font-size: var(--text-micro);
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
  font-size: var(--text-control);
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
  display: inline-block;
  opacity: 0;
}
.chat-list-row:hover .row-menu,
.chat-list-row:focus-within .row-menu {
  opacity: 1;
}
@media (hover: none) {
  .row-menu {
    opacity: 1;
  }
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
  font-size: var(--text-control);
}
</style>
