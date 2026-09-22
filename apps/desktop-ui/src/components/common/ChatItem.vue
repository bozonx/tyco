<template>
  <article class="chat-item" :class="`is-${message.role}`">
    <div class="chat-item-content">
      <div v-if="message.attachments?.length" class="message-attachments">
        <span
          class="message-attachment"
          :title="message.attachments.join('\n')"
        >
          <Icon icon="mdi:file-document-outline" height="14" />
          <span>{{ t('chat.editorContext') }}</span>
        </span>
      </div>

      <div
        v-if="message.role === 'assistant'"
        ref="markdownRoot"
        class="chat-markdown selectable"
        v-html="renderedContent"
        @click="handleMarkdownClick"
      />
      <div v-else class="chat-item-bubble selectable">
        {{ message.content }}
      </div>

      <div v-if="message.content" class="message-actions">
        <span v-if="message.status === 'stopped'" class="message-status">
          {{ t('chat.stopped') }}
        </span>
        <button type="button" class="message-action" @click="copyMessage">
          <Icon :icon="copied ? 'mdi:check' : 'mdi:content-copy'" height="14" />
          {{ copied ? t('chat.copied') : t('chat.copy') }}
        </button>
        <button
          v-if="message.role === 'assistant'"
          type="button"
          class="message-action"
          :disabled="generating"
          @click="emit('regenerate')"
        >
          <Icon icon="mdi:reload" height="14" />
          {{ t('chat.regenerate') }}
        </button>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUpdated, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { renderChatMarkdown } from '../../lib/chat/chat-markdown'
import { Icon } from '@iconify/vue'
import type { ChatMessage } from '@tyco/shared'

const props = defineProps<{ message: ChatMessage; generating?: boolean }>()
const emit = defineEmits<{ (e: 'regenerate'): void }>()
const { t } = useI18n()
const markdownRoot = ref<HTMLElement | null>(null)
const copied = ref(false)
const renderedContent = computed(() =>
  renderChatMarkdown(props.message.content)
)

async function enhanceCodeBlocks() {
  await nextTick()
  const { default: hljs } = await import('highlight.js')
  markdownRoot.value?.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code')
    if (!code) return
    if (!code.dataset.highlighted) hljs.highlightElement(code)
    if (pre.querySelector('.code-copy')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'code-copy'
    button.dataset.codeCopy = 'true'
    button.textContent = t('chat.copyCode')
    pre.append(button)
  })
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

function copyMessage() {
  void copyText(props.message.content)
}

function handleMarkdownClick(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-code-copy]'
  )
  const code = button?.parentElement?.querySelector('code')?.textContent
  if (button && code) void copyText(code)
}

onMounted(enhanceCodeBlocks)
onUpdated(enhanceCodeBlocks)
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
.chat-markdown {
  color: var(--color-base-content);
  font-size: 0.9375rem;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.chat-markdown :deep(> :first-child) {
  margin-top: 0;
}
.chat-markdown :deep(> :last-child) {
  margin-bottom: 0;
}
.chat-markdown :deep(p),
.chat-markdown :deep(ul),
.chat-markdown :deep(ol),
.chat-markdown :deep(blockquote),
.chat-markdown :deep(pre),
.chat-markdown :deep(table) {
  margin: 0.75em 0;
}
.chat-markdown :deep(ul),
.chat-markdown :deep(ol) {
  padding-left: 1.5rem;
}
.chat-markdown :deep(h1),
.chat-markdown :deep(h2),
.chat-markdown :deep(h3) {
  margin: 1.1em 0 0.45em;
  font-weight: 650;
  line-height: 1.3;
}
.chat-markdown :deep(h1) {
  font-size: 1.35rem;
}
.chat-markdown :deep(h2) {
  font-size: 1.18rem;
}
.chat-markdown :deep(h3) {
  font-size: 1.05rem;
}
.chat-markdown :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chat-markdown :deep(blockquote) {
  padding-left: var(--space-md);
  border-left: 3px solid var(--app-border-strong);
  color: var(--app-text-muted);
}
.chat-markdown :deep(code:not(pre code)) {
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
  font-family: var(--font-mono);
  font-size: 0.85em;
}
.chat-markdown :deep(pre) {
  position: relative;
  padding: 2.25rem var(--space-lg) var(--space-lg);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: var(--app-surface-raised);
  overflow: auto;
}
.chat-markdown :deep(pre code) {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}
.chat-markdown :deep(.code-copy) {
  position: absolute;
  top: 0.35rem;
  right: 0.4rem;
  padding: 0.2rem 0.45rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  font-size: 0.7rem;
  cursor: pointer;
}
.chat-markdown :deep(.code-copy:hover) {
  background: var(--app-hover);
}
.chat-markdown :deep(table) {
  display: block;
  max-width: 100%;
  border-collapse: collapse;
  overflow-x: auto;
}
.chat-markdown :deep(th),
.chat-markdown :deep(td) {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--app-border);
  text-align: left;
}
.message-actions {
  display: flex;
  gap: var(--space-xs);
  min-height: 1.7rem;
  margin-top: var(--space-xs);
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.message-status {
  align-self: center;
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
  gap: 0.25rem;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  font-size: 0.72rem;
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
  justify-content: flex-end;
  margin-bottom: var(--space-xs);
}
.message-attachment {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
  color: var(--app-text-muted);
  font-size: 0.72rem;
}
@media (hover: none) {
  .message-actions {
    opacity: 1;
  }
}
</style>
