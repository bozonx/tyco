<template>
  <div class="reply-block" :data-block-index="index">
    <div v-if="block.title" class="reply-block-header">
      <AppIcon
        icon="mdi:text-box-plus-outline"
        size="xs"
        class="reply-block-icon"
      />
      <span class="reply-block-title">{{ block.title }}</span>
    </div>

    <div class="reply-block-content">
      <Diff
        v-if="isDiffOpen && originalText"
        :old-text="originalText"
        :new-text="block.text"
        mode="unified"
      />
      <div v-else class="reply-block-text selectable">
        {{ block.text }}
      </div>
    </div>

    <div class="reply-block-actions">
      <Button
        v-if="canInsertIntoWindow"
        size="xs"
        variant="primary"
        icon="mdi:arrow-down-bold-box-outline"
        @click="emit('insert', block.text)"
      >
        {{ t('replyBlocks.insertIntoWindow') }}
      </Button>

      <Button
        v-if="canInsertIntoEditor"
        size="xs"
        variant="neutral"
        icon="mdi:pencil-outline"
        @click="emit('insertEditor', block.text)"
      >
        {{ t('replyBlocks.insertIntoEditor') }}
      </Button>

      <Button
        v-if="hasDiffOption"
        size="xs"
        variant="ghost"
        :icon="isDiffOpen ? 'mdi:eye-outline' : 'mdi:compare-horizontal'"
        @click="isDiffOpen = !isDiffOpen"
      >
        {{ isDiffOpen ? t('replyBlocks.hideDiff') : t('replyBlocks.showDiff') }}
      </Button>

      <CopyButton
        size="xs"
        variant="ghost"
        :value="block.text"
        :label="t('chat.copy')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ReplyBlockData } from '../../lib/reply-blocks/reply-blocks-tool'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import CopyButton from '../common/CopyButton.vue'
import Diff from '../common/Diff.vue'

const props = withDefaults(
  defineProps<{
    block: ReplyBlockData
    originalText?: string
    index?: number
    canInsertIntoWindow?: boolean
    canInsertIntoEditor?: boolean
  }>(),
  {
    originalText: '',
    index: 0,
    canInsertIntoWindow: true,
    canInsertIntoEditor: true,
  }
)

const emit = defineEmits<{
  (e: 'insert', text: string): void
  (e: 'insertEditor', text: string): void
}>()

const { t } = useI18n()
const isDiffOpen = ref(false)

const hasDiffOption = computed(
  () =>
    Boolean(props.originalText?.trim()) &&
    props.originalText.trim() !== props.block.text.trim()
)
</script>

<style scoped>
.reply-block {
  border: 1px solid var(--app-border);
  border-left: 3px solid var(--color-primary);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  padding: var(--space-sm) var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  transition: border-color var(--transition-fast);
}

.reply-block:hover {
  border-color: color-mix(
    in oklab,
    var(--color-primary) 50%,
    var(--app-border)
  );
  border-left-color: var(--color-primary);
}

.reply-block-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--app-text-muted);
}

.reply-block-icon {
  color: var(--color-primary);
  flex-shrink: 0;
}

.reply-block-content {
  font-size: var(--text-body);
  line-height: 1.55;
}

.reply-block-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.reply-block-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--app-border-subtle);
}
</style>
