<template>
  <button
    type="button"
    class="overlay-esc-button action-overlay-esc"
    :class="{ 'is-disabled': disabled }"
    :disabled="disabled"
    :title="resolvedTitle"
    @click="handleClick"
  >
    <AppIcon
      v-if="resolvedMode === 'back'"
      icon="mdi:arrow-left"
      size="sm"
      class="overlay-esc-icon"
    />
    <KeyboardKey>Esc</KeyboardKey>
    <span class="overlay-esc-label shortcut-label">{{ resolvedLabel }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import AppIcon from '../common/AppIcon.vue'
import KeyboardKey from '../common/KeyboardKey.vue'

const props = withDefaults(
  defineProps<{
    mode?: 'close' | 'back'
    label?: string
    title?: string
    disabled?: boolean
  }>(),
  { mode: 'close', label: undefined, title: undefined, disabled: false }
)

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
  (e: 'close-all'): void
}>()

const { t } = useI18n()

const resolvedMode = computed(() => props.mode)

const resolvedLabel = computed(() => {
  if (props.label) return props.label
  return resolvedMode.value === 'back' ? t('common.back') : t('common.close')
})

const resolvedTitle = computed(() => {
  if (props.title) return props.title
  if (resolvedMode.value === 'back') return resolvedLabel.value
  return t('common.closeAllHint')
})

function handleClick(event: MouseEvent) {
  if (props.disabled) return
  if (event.shiftKey) {
    emit('close-all')
  }
  emit('click', event)
}
</script>

<style scoped>
.overlay-esc-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  font-size: var(--text-control);
  color: var(--app-text-muted);
  cursor: pointer;
  background: transparent;
  border: none;
  flex-shrink: 0;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    opacity var(--transition-fast);
}

.overlay-esc-button:hover:not(:disabled) {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.overlay-esc-button:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 2px;
}

.overlay-esc-button:disabled,
.overlay-esc-button.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.overlay-esc-icon {
  flex-shrink: 0;
}

.overlay-esc-label {
  line-height: 1.25;
  white-space: nowrap;
}
</style>
