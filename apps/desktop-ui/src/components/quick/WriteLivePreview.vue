<template>
  <div
    class="write-live-preview"
    :class="[
      `status-${status}`,
      { 'is-clickable': canAccept, 'is-changed': isChanged },
    ]"
    role="status"
    aria-live="polite"
    @mousedown.prevent
    @click="handleClick"
  >
    <div class="write-live-header">
      <div class="write-live-tag">
        <AppIcon
          v-if="status === 'loading'"
          icon="mdi:loading"
          size="xs"
          class="animate-spin text-primary"
        />
        <AppIcon
          v-else
          icon="mdi:creation-outline"
          size="xs"
          class="text-primary"
        />
        <span class="write-live-label">{{ t('write.livePreview') }}</span>
      </div>
      <span v-if="status === 'loading'" class="write-live-status">
        {{ t('write.liveCorrecting') }}
      </span>
      <span v-else-if="text && isChanged" class="write-live-hint">
        {{ t('write.clickToApply') }}
      </span>
      <span v-else-if="text && !isChanged" class="write-live-status text-muted">
        {{ t('write.alreadyCorrected') }}
      </span>
    </div>

    <div class="write-live-body">
      <span v-if="text" class="write-live-text">{{ text }}</span>
      <span v-else class="write-live-placeholder">
        {{ t('write.liveCorrecting') }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { LiveCorrectionStatus } from '../../lib/quick-input/live-correction'
import AppIcon from '../common/AppIcon.vue'

const props = defineProps<{
  status: LiveCorrectionStatus
  text: string
  originalText: string
}>()

const emit = defineEmits<{ (e: 'accept', text: string): void }>()

const { t } = useI18n()

const isChanged = computed(() => {
  return props.text.trim() !== props.originalText.trim()
})

const canAccept = computed(() => {
  return props.status === 'ready' && Boolean(props.text) && isChanged.value
})

function handleClick() {
  if (canAccept.value) {
    emit('accept', props.text)
  }
}
</script>

<style scoped>
.write-live-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-quick-surface);
  backdrop-filter: var(--app-quick-backdrop);
  box-shadow: var(--app-shadow-sm);
  font-size: var(--text-caption);
  color: var(--app-text);
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast);
  max-height: 8rem;
  overflow-y: auto;
  user-select: text;
}

.write-live-preview.is-clickable {
  cursor: pointer;
}

.write-live-preview.is-clickable:hover {
  border-color: var(--color-primary);
  background-color: var(--app-hover);
}

.write-live-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  font-size: var(--text-micro);
  color: var(--app-text-muted);
}

.write-live-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.write-live-hint {
  font-size: var(--text-micro);
  color: var(--color-primary);
}

.write-live-status {
  font-size: var(--text-micro);
}

.write-live-body {
  line-height: var(--editor-line-height);
  white-space: pre-wrap;
  word-break: break-word;
}

.write-live-text {
  color: var(--color-base-content);
}

.write-live-placeholder {
  color: var(--app-text-muted);
  font-style: italic;
}
</style>
