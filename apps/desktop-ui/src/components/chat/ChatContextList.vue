<template>
  <div v-if="visible" class="context-list">
    <ChatAttachment
      v-for="(attachment, index) in attachments"
      :key="`attachment-${attachment}`"
      :label="t('chat.selectedText')"
      :text="attachment"
      icon="mdi:selection-drag"
      removable
      announce
      @remove="chatStore.removeAttachment(index)"
    />
    <ChatAttachment
      v-if="editorContext"
      :key="`editor-${editorContext.source}-${editorContext.mode}`"
      :label="editorContextLabel"
      :text="editorContext.text"
      :variant="editorContext.mode"
      icon="mdi:file-document-edit-outline"
      removable
      :announce="editorContext.mode === 'attached'"
      @remove="chatStore.dismissEditorContext(editorContext.text)"
      @accept="chatStore.acceptEditorContext(editorContext.text)"
    />
    <Button
      v-if="editorContext && chatStore.messages.length > 0"
      xs
      ghost
      icon="mdi:message-plus-outline"
      class="new-chat-context-btn"
      :title="t('chat.startNewChatWithContext')"
      @click="startNewChatWithContext"
    >
      {{ t('chat.startNewChatWithContext') }}
    </Button>
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
import { useChatStore } from '../../stores/chat'
import Button from '../common/Button.vue'
import ChatAttachment from './ChatAttachment.vue'
import { Icon } from '@iconify/vue'

/** What goes to the next chat message along with it, and what may go */
const chatStore = useChatStore()
const { t } = useI18n()

const attachments = computed(() => chatStore.newChatParams?.attachments || [])
const editorContext = computed(() => chatStore.editorContext)

const editorContextLabel = computed(() => {
  const context = editorContext.value
  if (!context) return ''
  const label =
    context.source === 'selection'
      ? t('chat.editorSelection')
      : t('chat.editorText')
  return context.updated ? `${label} · ${t('chat.contextUpdated')}` : label
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
    attachments.value.length > 0 ||
    Boolean(editorContext.value) ||
    Boolean(budgetWarning.value)
)

function startNewChatWithContext() {
  const context = editorContext.value
  if (!context) return
  void chatStore.startChat({ attachments: [context.text] })
}
</script>

<style scoped>
.context-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}
.new-chat-context-btn {
  font-size: 0.72rem;
  color: var(--color-primary);
}
.context-budget {
  display: flex;
  flex-basis: 100%;
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
