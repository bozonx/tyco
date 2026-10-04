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
        v-if="historyStore.chatHistory.length"
        sm
        ghost
        square
        :title="t('history.clear')"
        @click="confirmingClear = !confirmingClear"
      >
        <Icon icon="mdi:trash-can-outline" height="18" />
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

    <div v-if="confirmingClear" class="sidebar-clear-box">
      <div class="sidebar-clear-msg">
        {{
          t('history.clearConfirm', { count: historyStore.chatHistory.length })
        }}
      </div>
      <div class="sidebar-clear-actions">
        <Button xs ghost @click="confirmingClear = false">
          {{ t('common.cancel') }}
        </Button>
        <Button
          xs
          icon="mdi:trash-can-outline"
          class="confirm-clear-btn"
          @click="clearAllChats"
        >
          {{ t('history.clearConfirmButton') }}
        </Button>
      </div>
    </div>

    <div v-if="removedChat" class="sidebar-notice">
      <Icon icon="mdi:trash-can-outline" height="15" class="shrink-0" />
      <span class="truncate flex-1">{{ t('history.itemRemoved') }}</span>
      <Button xs ghost icon="mdi:undo" @click="undoRemoveChat">
        {{ t('history.undo') }}
      </Button>
    </div>

    <div v-if="chatHistoryDisabled" class="sidebar-notice">
      <Icon icon="mdi:information-outline" height="15" class="shrink-0" />
      <span>{{ t('history.chatsDisabled') }}</span>
    </div>

    <SearchInput
      v-model="query"
      class="sidebar-search"
      :placeholder="t('chat.searchChats')"
    />

    <div class="chat-list-scroll">
      <ul v-if="draftChat" class="chat-list draft-list">
        <li class="chat-list-row">
          <button
            type="button"
            class="chat-list-item is-active"
            :title="draftChat"
            @click="emit('navigate')"
          >
            <Icon
              icon="mdi:message-plus-outline"
              height="15"
              class="shrink-0"
            />
            <span class="truncate">{{ draftChat }}</span>
          </button>
        </li>
      </ul>
      <div v-if="groups.length === 0 && !draftChat" class="chat-list-empty">
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
              <button
                type="button"
                class="row-action"
                :title="t('chat.renameChat')"
                @click="beginRename(item)"
              >
                <Icon icon="mdi:pencil-outline" height="15" />
              </button>
              <button
                type="button"
                class="row-action danger"
                :title="t('chat.deleteChat')"
                @click="removeChat(item.id)"
              >
                <Icon icon="mdi:trash-can-outline" height="15" />
              </button>
            </template>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import {
  filterChatHistory,
  groupChatHistory,
} from '../../lib/chat/chat-history-list'
import { useChatStore } from '../../stores/chat'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import SearchInput from '../common/SearchInput.vue'
import { Icon } from '@iconify/vue'
import type { ChatHistoryItem } from '@tyco/shared'

const emit = defineEmits<{ (e: 'collapse'): void; (e: 'navigate'): void }>()
const { t } = useI18n()
const { toast } = useToast()
const chatStore = useChatStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()

const query = ref('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputs = ref<HTMLInputElement[]>([])
const confirmingClear = ref(false)
const removedChat = ref<ChatHistoryItem | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | undefined

const isLimitZero = (value: unknown) => String(value ?? '').trim() === '0'
const chatHistoryDisabled = computed(() =>
  isLimitZero(ipcStore.params.userConfig?.chatHistoryMaxItems)
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

/** The current chat while it is not stored yet: it is shown on top anyway */
const draftChat = computed(() => {
  const id = chatStore.newChatParams.id
  if (query.value.trim()) return null
  if (id && historyStore.chatHistory.some((item) => item.id === id)) {
    return null
  }
  return chatStore.newChatParams.title || t('chat.newChat')
})

async function startChat() {
  await chatStore.startChat({})
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

async function clearAllChats() {
  confirmingClear.value = false
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
.sidebar-clear-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.8125rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface);
}
.sidebar-clear-msg {
  color: var(--app-text-muted);
}
.sidebar-clear-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-xs);
}
.confirm-clear-btn {
  color: var(--color-error-content);
  background-color: var(--color-error);
  border-color: var(--color-error);
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
.draft-list + .chat-group {
  margin-top: var(--space-lg);
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
  padding: 0.5rem 3.7rem 0.5rem 0.625rem;
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
.row-action {
  position: absolute;
  right: 1.85rem;
  display: none;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  cursor: pointer;
}
.row-action:last-child {
  right: 0.2rem;
}
.chat-list-row:hover .row-action,
.row-action:focus-visible {
  display: flex;
}
.row-action:hover {
  background: var(--app-surface);
  color: var(--color-base-content);
}
.row-action.danger:hover {
  color: var(--color-error);
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
