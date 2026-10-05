<template>
  <div
    v-if="attachments.length || chatStore.editorContext"
    class="context-list"
  >
    <ChatAttachment
      v-for="(attachment, index) in attachments"
      :key="`attachment-${index}`"
      :label="t('chat.selectedText')"
      :text="attachment"
      icon="mdi:selection-drag"
      :initially-open="expanded"
      removable
      @remove="chatStore.removeAttachment(index)"
    />
    <ChatAttachment
      v-if="chatStore.editorContext"
      :key="`editor-${chatStore.editorContext.source}`"
      :label="editorContextLabel"
      :text="chatStore.editorContext.text"
      icon="mdi:file-document-edit-outline"
      :initially-open="expanded"
      removable
      @remove="dismissEditorContext"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useChatStore } from '../../stores/chat'
import ChatAttachment from './ChatAttachment.vue'

/** What goes to the next chat message along with it */
defineProps<{
  /** Shows the texts themselves, not only their labels */
  expanded?: boolean
}>()

const chatStore = useChatStore()
const { t } = useI18n()

const attachments = computed(() => chatStore.newChatParams?.attachments || [])

const editorContextLabel = computed(() => {
  const context = chatStore.editorContext
  if (!context) return ''
  const label =
    context.source === 'selection'
      ? t('chat.editorSelection')
      : t('chat.editorText')
  return context.updated ? `${label} · ${t('chat.contextUpdated')}` : label
})

function dismissEditorContext() {
  const context = chatStore.editorContext
  if (context) chatStore.dismissEditorContext(context.text)
}
</script>

<style scoped>
.context-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}
</style>
