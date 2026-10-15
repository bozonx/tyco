<template>
  <div class="selection-context-preview">
    <div class="context-preview-header">
      <Icon :icon="icon" height="14" class="shrink-0 text-primary" />
      <span class="context-preview-title">{{ title }}</span>
      <IconButton
        class="context-preview-remove"
        size="xs"
        variant="ghost"
        :label="removeTitle"
        icon="mdi:close"
        @mousedown.prevent
        @click="emit('remove')"
      />
    </div>
    <TextPreview :text="text" />
  </div>
</template>

<script setup lang="ts">
import Icon from './AppIcon.vue'
import IconButton from './IconButton.vue'
import TextPreview from './TextPreview.vue'

withDefaults(
  defineProps<{
    text: string
    title: string
    icon?: string
    removeTitle?: string
  }>(),
  { icon: 'mdi:selection-drag', removeTitle: '' }
)

const emit = defineEmits<{ (e: 'remove'): void }>()
</script>

<style scoped>
.selection-context-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
}

.context-preview-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
  color: var(--app-text-muted);
  font-size: var(--text-caption);
}

.context-preview-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-preview-remove {
  flex-shrink: 0;
}
</style>
