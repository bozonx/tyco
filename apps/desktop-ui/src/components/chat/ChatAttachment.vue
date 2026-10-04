<template>
  <span class="chat-attachment" :class="{ 'is-open': open }">
    <button
      type="button"
      class="chat-attachment-toggle"
      :title="t('chat.showAttachment')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Icon :icon="icon" height="14" class="shrink-0" />
      <span class="truncate">{{ label }}</span>
      <span class="chat-attachment-size">{{ size }}</span>
    </button>
    <button
      v-if="removable"
      type="button"
      class="chat-attachment-remove"
      :title="t('chat.removeAttachment')"
      @click="emit('remove')"
    >
      <Icon icon="mdi:close" height="14" />
    </button>
  </span>
  <pre v-if="open" class="chat-attachment-preview selectable">{{ text }}</pre>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  label: string
  text: string
  icon?: string
  removable?: boolean
}>()
const emit = defineEmits<{ (e: 'remove'): void }>()
const { t } = useI18n()
const open = ref(false)

const icon = computed(() => props.icon || 'mdi:text-box-outline')
const size = computed(() =>
  t('chat.attachmentSize', { count: props.text.length.toLocaleString() })
)
</script>

<style scoped>
.chat-attachment {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
  color: var(--app-text-muted);
  font-size: 0.72rem;
}
.chat-attachment.is-open {
  border-color: color-mix(in oklab, var(--color-primary) 45%, transparent);
}
.chat-attachment-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-md);
  color: inherit;
  cursor: pointer;
}
.chat-attachment-toggle:hover {
  color: var(--color-base-content);
}
.chat-attachment-size {
  color: var(--app-text-faint);
  white-space: nowrap;
}
.chat-attachment-remove {
  display: inline-flex;
  margin-right: 0.2rem;
  padding: 0.15rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  cursor: pointer;
}
.chat-attachment-remove:hover {
  background: var(--app-hover);
  color: var(--color-error);
}
.chat-attachment-preview {
  flex-basis: 100%;
  max-height: 10rem;
  margin: 0;
  overflow: auto;
  padding: var(--space-sm);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
  color: var(--app-text-muted);
  font: inherit;
  font-size: 0.75rem;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
