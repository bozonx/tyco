<template>
  <article class="chat-item" :class="`is-${message.role}`">
    <div class="chat-item-content">
      <div v-if="message.attachments?.length" class="message-attachments">
        <ChatAttachment
          v-for="(attachment, index) in message.attachments"
          :key="index"
          :text="attachment.text"
          :source="attachment.source"
          :name="attachment.name"
          :media-type="attachment.mediaType"
        />
      </div>

      <div v-if="message.images?.length" class="flex flex-wrap gap-2">
        <ChatImageAttachment
          v-for="image in message.images"
          :key="image.id"
          :image="image"
          @loaded="emit('content-resized')"
        />
      </div>
      <ChatMarkdown
        v-if="message.role === 'assistant'"
        :content="message.content"
        :streaming="streaming"
        @copy-code="copyText"
        @content-resized="emit('content-resized')"
      />
      <div v-else-if="message.content" class="chat-item-bubble selectable">
        {{ message.content }}
      </div>

      <div
        v-if="message.content || message.images?.length"
        class="message-actions"
      >
        <span v-if="message.status === 'stopped'" class="message-status">
          {{ t('chat.stopped') }}
        </span>
        <button
          v-if="message.content"
          type="button"
          class="message-action"
          :title="copied ? t('chat.copied') : t('chat.copy')"
          :aria-label="copied ? t('chat.copied') : t('chat.copy')"
          @click="copyMessage"
        >
          <Icon :icon="copied ? 'mdi:check' : 'mdi:content-copy'" height="14" />
        </button>
        <DropdownMenu
          xs
          square
          hide-chevron
          placement="top"
          align="right"
          icon="mdi:dots-horizontal"
          :title="t('common.more')"
          :items="moreMenuItems"
        />
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import ChatAttachment from '../chat/ChatAttachment.vue'
import ChatImageAttachment from '../chat/ChatImageAttachment.vue'
import ChatMarkdown from '../chat/ChatMarkdown.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import { Icon } from '@iconify/vue'
import type { ChatMessage } from '@tyco/shared'

const props = defineProps<{ message: ChatMessage; streaming?: boolean }>()
const emit = defineEmits<{
  (e: 'branch'): void
  (e: 'copy-markdown-to-point'): void
  (e: 'content-resized'): void
}>()
const { t } = useI18n()
const copied = ref(false)

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  {
    label: t('chat.copyMarkdownToPoint'),
    icon: 'mdi:language-markdown',
    action: () => emit('copy-markdown-to-point'),
  },
  {
    label: t('chat.branchChat'),
    icon: 'mdi:source-branch',
    action: () => emit('branch'),
  },
])
async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

function copyMessage() {
  void copyText(props.message.content)
}
</script>

<style scoped>
.chat-item {
  display: flex;
  width: 100%;
}
.chat-item-content {
  min-width: 0;
  max-width: min(86%, 46rem);
}
.chat-item.is-user {
  justify-content: flex-end;
}
.chat-item.is-assistant .chat-item-content {
  width: 100%;
}
.chat-item-bubble {
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm)
    var(--radius-lg);
  background-color: var(--color-primary);
  color: var(--color-primary-content);
  font-size: 0.9375rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.message-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-xs);
  min-height: 1.7rem;
  margin-top: var(--space-xs);
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.message-status {
  align-self: center;
  margin-right: auto;
  color: var(--app-text-faint);
  font-size: 0.72rem;
}
.chat-item-content:hover .message-actions,
.message-actions:focus-within {
  opacity: 1;
}
.message-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  cursor: pointer;
}
.message-action:hover {
  background: var(--app-hover);
}
.message-action:disabled {
  opacity: 0.45;
  cursor: default;
}
.message-attachments {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}
@media (hover: none) {
  .message-actions {
    opacity: 1;
  }
}
</style>
