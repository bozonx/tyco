<template>
  <div
    class="parallel-mode-toggle"
    role="radiogroup"
    :aria-label="t('menu.reviewResult')"
  >
    <button
      type="button"
      role="radio"
      :aria-checked="props.modelValue === 'split'"
      class="mode-button"
      :class="{ 'is-active': props.modelValue === 'split' }"
      :title="t('diff.modeSplit')"
      @click="selectMode('split')"
    >
      <Icon icon="mdi:view-split-vertical" class="mode-icon" height="15" />
      <span class="mode-label">{{ t('diff.modeSplit') }}</span>
    </button>

    <button
      type="button"
      role="radio"
      :aria-checked="props.modelValue === 'result'"
      class="mode-button"
      :class="{ 'is-active': props.modelValue === 'result' }"
      :title="t('diff.modeResult')"
      @click="selectMode('result')"
    >
      <Icon icon="mdi:file-document-outline" class="mode-icon" height="15" />
      <span class="mode-label">{{ t('diff.modeResult') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { Icon } from '@iconify/vue'

export type ParallelViewMode = 'split' | 'result'

const props = defineProps<{ modelValue: ParallelViewMode }>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: ParallelViewMode): void
}>()

const { t } = useI18n()

function selectMode(mode: ParallelViewMode) {
  if (props.modelValue !== mode) {
    emit('update:modelValue', mode)
  }
}
</script>

<style scoped>
.parallel-mode-toggle {
  display: inline-flex;
  align-items: center;
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  padding: 2px;
  gap: 2px;
  user-select: none;
}

.mode-button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--app-text-muted);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.mode-button:hover:not(.is-active) {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.mode-button.is-active {
  background-color: var(--app-surface-raised);
  color: var(--color-base-content);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.mode-icon {
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .mode-label {
    display: none;
  }
  .mode-button {
    padding: 0.3rem 0.4rem;
  }
}
</style>
