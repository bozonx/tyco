<template>
  <span
    class="chat-attachment"
    :class="{
      'is-open': open,
      'is-arriving': arriving,
      'is-pending': removable,
    }"
  >
    <button
      type="button"
      class="chat-attachment-toggle"
      :title="toggleTitle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Icon
        :icon="attachmentIcon(source, mediaType)"
        height="14"
        class="shrink-0"
      />
      <span class="chat-attachment-label">{{ label }}</span>
      <span class="chat-attachment-excerpt">{{ excerpt }}</span>
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
import { computed, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  attachmentExcerpt,
  attachmentIcon,
  attachmentLabelKey,
  attachmentTitle,
} from '../../lib/chat/chat-attachment'
import { Icon } from '@iconify/vue'
import type { ChatAttachmentSource } from '@tyco/shared'

/** A text attached to a chat message: one sent, or one going with the next */
const props = defineProps<{
  text: string
  source?: ChatAttachmentSource
  name?: string
  mediaType?: string
  /** Follows the label, e.g. that the text changed */
  note?: string
  removable?: boolean
  /** Draws attention when it appears: it may arrive after the chat opened */
  announce?: boolean
}>()
const emit = defineEmits<{ (e: 'remove'): void }>()
const { t } = useI18n()
const open = ref(false)
const arriving = ref(false)

const label = computed(() => {
  const base = props.name || t(attachmentLabelKey(props.source))
  return props.note ? `${base} · ${props.note}` : base
})
const excerpt = computed(() => attachmentExcerpt(props.text))
const size = computed(() =>
  t('chat.attachmentSize', { count: props.text.length.toLocaleString() })
)
const toggleTitle = computed(() =>
  attachmentTitle(t('chat.showAttachment'), props.text)
)

onMounted(() => {
  if (props.announce) arriving.value = true
})
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
.chat-attachment.is-pending {
  border-color: color-mix(
    in oklab,
    var(--color-primary) 35%,
    var(--app-border)
  );
}
.chat-attachment.is-open {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
}
.chat-attachment.is-arriving {
  animation: chat-attachment-arrive 1.2s ease-out;
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
.chat-attachment-label {
  flex-shrink: 0;
  font-weight: 500;
  white-space: nowrap;
}
.chat-attachment-excerpt {
  min-width: 0;
  max-width: 18rem;
  overflow: hidden;
  color: var(--app-text-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-attachment-excerpt::before {
  content: '«';
}
.chat-attachment-excerpt::after {
  content: '»';
}
.chat-attachment-size {
  flex-shrink: 0;
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
@keyframes chat-attachment-arrive {
  0% {
    box-shadow: 0 0 0 0
      color-mix(in oklab, var(--color-primary) 55%, transparent);
    background: var(--app-accent-soft);
  }
  100% {
    box-shadow: 0 0 0 0.5rem transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chat-attachment.is-arriving {
    animation: none;
  }
}
</style>
