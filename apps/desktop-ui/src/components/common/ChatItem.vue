<template>
  <div class="chat-item" :class="`is-${message.role}`">
    <div class="chat-item-bubble selectable">{{ message.content }}</div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessage } from '@tyco/shared'

defineProps<{ message: ChatMessage }>()
</script>

<style scoped>
.chat-item {
  display: flex;
}

.chat-item-bubble {
  max-width: min(80%, 42rem);
  padding: 0.5625rem 0.875rem;
  border-radius: var(--radius-lg);
  font-size: 0.9375rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-item.is-user {
  justify-content: flex-end;
}

.chat-item.is-user .chat-item-bubble {
  border-bottom-right-radius: var(--radius-sm);
  background-color: var(--color-primary);
  color: var(--color-primary-content);
}

.chat-item.is-assistant .chat-item-bubble {
  border: 1px solid var(--app-border-subtle);
  border-bottom-left-radius: var(--radius-sm);
  background-color: var(--app-surface-raised);
}

.chat-item.is-developer {
  justify-content: center;
}

.chat-item.is-developer .chat-item-bubble {
  font-size: 0.8125rem;
  color: var(--app-text-muted);
  background-color: var(--app-hover);
}
</style>
