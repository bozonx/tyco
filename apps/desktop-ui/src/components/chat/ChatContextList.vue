<template>
  <div v-if="visible" class="context-list">
    <div v-if="attached.length || images.length" class="context-attached">
      <ChatImageAttachment
        v-for="image in images"
        :key="image.id"
        :image="image"
        removable
        compact
        @remove="chatStore.removeImage(image.id)"
      />
      <ChatAttachment
        v-for="(attachment, index) in attachments"
        :key="`attachment-${index}`"
        :text="attachment.text"
        :source="attachment.source"
        :name="attachment.name"
        :media-type="attachment.mediaType"
        removable
        announce
        @remove="chatStore.removeAttachment(index)"
      />
    </div>

    <div
      v-if="budgetWarning"
      class="context-budget"
      :class="`is-${budgetWarning.level}`"
      role="status"
    >
      <AppIcon icon="mdi:alert-outline" size="sm" class="shrink-0" />
      <span>{{ budgetWarning.text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useChatScope } from '../../composables/use-chat-scope'
import { useI18n } from '../../composables/use-i18n'
import AppIcon from '../common/AppIcon.vue'
import ChatAttachment from './ChatAttachment.vue'
import ChatImageAttachment from './ChatImageAttachment.vue'

/** What goes to the next chat message along with it: images and texts in one row */
const { chat: chatStore } = useChatScope()
const { t, locale } = useI18n()

const attachments = computed(
  () => chatStore.currentChatParams?.attachments || []
)
const attached = computed(() => chatStore.attachedContext)
const images = computed(() => chatStore.pendingImages)

const budgetWarning = computed(() => {
  const budget = chatStore.contextBudget
  if (!budget || budget.level === 'ok') return null
  return {
    level: budget.level,
    text:
      budget.level === 'over'
        ? t('chat.contextBudgetOver', {
            used: budget.usedCharacters.toLocaleString(locale.value),
            budget: budget.budgetCharacters.toLocaleString(locale.value),
          })
        : t('chat.contextBudgetHigh', { percent: budget.usagePercent }),
  }
})

const visible = computed(
  () =>
    attached.value.length > 0 ||
    images.value.length > 0 ||
    Boolean(budgetWarning.value)
)
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
.context-budget {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--text-caption);
}
.context-budget.is-high {
  color: var(--color-warning);
}
.context-budget.is-over {
  color: var(--color-error);
}
</style>
