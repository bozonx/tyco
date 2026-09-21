<template>
  <aside class="chat-sidebar">
    <Button sm class="w-full" icon="mdi:plus" @click="chatStore.startChat({})">
      {{ t('chat.newChat') }}
    </Button>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="historyStore.chatHistory.length === 0" class="chat-list-empty">
        {{ t('history.empty') }}
      </div>
      <ul v-else class="chat-list">
        <li v-for="item in historyStore.chatHistory" :key="item.id">
          <button
            type="button"
            class="chat-list-item"
            :class="{ 'is-active': chatStore.newChatParams?.id === item.id }"
            :title="item.description"
            @click="chatStore.openChat(item.id)"
          >
            <Icon icon="mdi:message-outline" height="15" class="shrink-0" />
            <span class="truncate">
              {{ item.description || t('common.empty') }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { useChatStore } from '../../stores/chat'
import { useHistoryStore } from '../../stores/history'
import Button from '../common/Button.vue'
import { Icon } from '@iconify/vue'

const { t } = useI18n()
const chatStore = useChatStore()
const historyStore = useHistoryStore()
</script>

<style scoped>
.chat-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 232px;
  flex-shrink: 0;
  height: 100%;
  padding: var(--space-lg) var(--space-md);
  border-right: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}

.chat-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-list-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: 0.4375rem 0.625rem;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  text-align: left;
  color: var(--app-text-muted);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.chat-list-item:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.chat-list-item.is-active {
  color: var(--color-base-content);
  background-color: var(--app-active);
  font-weight: 500;
}

.chat-list-empty {
  padding: var(--space-sm) var(--space-sm);
  font-size: 0.8125rem;
  color: var(--app-text-faint);
}
</style>
