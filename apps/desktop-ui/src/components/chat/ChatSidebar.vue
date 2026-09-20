<template>
  <div class="chat-sidebar flex flex-col gap-4 h-full">
    <Button class="w-full" @click="chatStore.startChat({})">
      <Icon icon="mdi:plus" height="20" />
      {{ t('chat.newChat') }}
    </Button>

    <div class="flex-1 overflow-y-auto">
      <div v-if="historyStore.chatHistory.length === 0" class="text-sm text-gray-500 italic px-2">
        {{ t('history.empty') }}
      </div>
      <ul v-else class="flex flex-col gap-1">
        <li v-for="item in historyStore.chatHistory" :key="item.id">
          <Button
            class="w-full justify-start text-left normal-case font-normal"
            sm
            :ghost="chatStore.newChatParams?.id !== item.id"
            @click="chatStore.openChat(item.id)"
          >
            <div class="truncate w-full">
              {{ item.description || t('common.empty') }}
            </div>
          </Button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { useChatStore } from '../../stores/chat'
import { useHistoryStore } from '../../stores/history'
import { Icon } from '@iconify/vue'
import Button from '../common/Button.vue'

const { t } = useI18n()
const chatStore = useChatStore()
const historyStore = useHistoryStore()
</script>

<style scoped>
.chat-sidebar {
  width: 280px;
  border-right: 1px solid var(--color-border);
  padding: 1rem;
  background-color: var(--color-base-200);
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

li {
  list-style: none;
}

/* Custom scrollbar for better look */
.overflow-y-auto::-webkit-scrollbar {
  width: 4px;
}
.overflow-y-auto::-webkit-scrollbar-thumb {
  background: var(--color-base-300);
  border-radius: 10px;
}
</style>
