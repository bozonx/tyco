<template>
  <div v-if="visible" class="context-list">
    <!-- the editor is not in view of the chat: its text is only offered,
         and the whole row is the action that attaches it -->
    <div v-if="suggestion" class="context-suggestion" role="status">
      <button
        type="button"
        class="context-suggestion-attach"
        :title="suggestion.title"
        @click="chatStore.acceptEditorContext(suggestion.text)"
      >
        <Icon icon="mdi:paperclip" height="14" class="shrink-0" />
        <span class="context-suggestion-text">
          {{ suggestion.label }}
          <span class="context-suggestion-excerpt">{{
            suggestion.excerpt
          }}</span>
        </span>
      </button>
      <button
        v-if="chatStore.messages.length > 0"
        type="button"
        class="context-suggestion-icon"
        :title="t('chat.startNewChatWithContext')"
        @click="startNewChatWithContext"
      >
        <Icon icon="mdi:message-plus-outline" height="14" />
      </button>
      <button
        type="button"
        class="context-suggestion-icon"
        :title="t('chat.hideSuggestion')"
        @click="chatStore.dismissEditorContext(suggestion.text)"
      >
        <Icon icon="mdi:close" height="14" />
      </button>
    </div>

    <div v-if="attached.length" class="context-attached">
      <ChatAttachment
        v-for="(attachment, index) in attachments"
        :key="`attachment-${attachment.text}`"
        :text="attachment.text"
        :source="attachment.source"
        removable
        announce
        @remove="chatStore.removeAttachment(index)"
      />
      <ChatAttachment
        v-if="editorContext?.mode === 'attached'"
        :key="`editor-${editorContext.text}`"
        :text="editorContext.text"
        :source="editorContext.source"
        :note="editorContext.updated ? t('chat.contextUpdated') : undefined"
        removable
        announce
        @remove="chatStore.dismissEditorContext(editorContext.text)"
      />
    </div>

    <div
      v-if="budgetWarning"
      class="context-budget"
      :class="`is-${budgetWarning.level}`"
      role="status"
    >
      <Icon icon="mdi:alert-outline" height="14" class="shrink-0" />
      <span>{{ budgetWarning.text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  attachmentExcerpt,
  attachmentTitle,
} from '../../lib/chat/chat-attachment'
import { useChatStore } from '../../stores/chat'
import ChatAttachment from './ChatAttachment.vue'
import { Icon } from '@iconify/vue'

/** What goes to the next chat message along with it, and what may go */
const chatStore = useChatStore()
const { t } = useI18n()

const attachments = computed(() => chatStore.newChatParams?.attachments || [])
const editorContext = computed(() => chatStore.editorContext)
const attached = computed(() => chatStore.attachedContext)

const suggestion = computed(() => {
  const context = editorContext.value
  if (context?.mode !== 'suggested') return null
  const key = context.updated
    ? 'chat.suggestEditorUpdated'
    : context.source === 'editor-selection'
      ? 'chat.suggestEditorSelection'
      : 'chat.suggestEditorText'
  return {
    text: context.text,
    label: t(key),
    excerpt: attachmentExcerpt(context.text),
    title: attachmentTitle(
      t('chat.attachmentSize', { count: context.text.length.toLocaleString() }),
      context.text
    ),
  }
})

const budgetWarning = computed(() => {
  const budget = chatStore.contextBudget
  if (!budget || budget.level === 'ok') return null
  return {
    level: budget.level,
    text:
      budget.level === 'over'
        ? t('chat.contextBudgetOver', {
            used: budget.used.toLocaleString(),
            budget: budget.budget.toLocaleString(),
          })
        : t('chat.contextBudgetHigh', { percent: budget.percent }),
  }
})

const visible = computed(
  () =>
    attached.value.length > 0 ||
    Boolean(suggestion.value) ||
    Boolean(budgetWarning.value)
)

function startNewChatWithContext() {
  const context = editorContext.value
  if (!context) return
  void chatStore.startChat({
    attachments: [{ text: context.text, source: context.source }],
  })
}
</script>

<style scoped>
.context-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.context-attached {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}
.context-suggestion {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  min-width: 0;
  max-width: 100%;
  align-self: flex-start;
  color: var(--app-text-faint);
  font-size: 0.72rem;
}
.context-suggestion-attach {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  padding: 0.2rem 0.5rem;
  border: 1px dashed var(--app-border);
  border-radius: var(--radius-md);
  color: inherit;
  cursor: pointer;
}
.context-suggestion-attach:hover {
  border-style: solid;
  background: var(--app-hover);
  color: var(--color-base-content);
}
.context-suggestion-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-suggestion-excerpt {
  opacity: 0.75;
}
.context-suggestion-excerpt::before {
  content: ' «';
}
.context-suggestion-excerpt::after {
  content: '»';
}
.context-suggestion-icon {
  display: inline-flex;
  flex-shrink: 0;
  padding: 0.2rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-faint);
  cursor: pointer;
}
.context-suggestion-icon:hover {
  background: var(--app-hover);
  color: var(--color-base-content);
}
.context-budget {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
}
.context-budget.is-high {
  color: var(--color-warning);
}
.context-budget.is-over {
  color: var(--color-error);
}
</style>
