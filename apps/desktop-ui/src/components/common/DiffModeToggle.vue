<template>
  <div
    class="diff-mode-toggle"
    role="radiogroup"
    :aria-label="t('menu.compareResult')"
  >
    <button
      type="button"
      role="radio"
      :aria-checked="props.modelValue === 'unified'"
      class="diff-mode-button"
      :class="{ 'is-active': props.modelValue === 'unified' }"
      :title="t('diff.modeUnified')"
      @click="selectMode('unified')"
    >
      <Icon icon="mdi:view-agenda-outline" class="diff-mode-icon" height="15" />
      <span class="diff-mode-label">{{ t('diff.modeUnified') }}</span>
    </button>

    <button
      type="button"
      role="radio"
      :aria-checked="props.modelValue === 'split'"
      class="diff-mode-button"
      :class="{ 'is-active': props.modelValue === 'split' }"
      :title="t('diff.modeSplit')"
      @click="selectMode('split')"
    >
      <Icon icon="mdi:view-split-vertical" class="diff-mode-icon" height="15" />
      <span class="diff-mode-label">{{ t('diff.modeSplit') }}</span>
    </button>

    <button
      type="button"
      role="radio"
      :aria-checked="props.modelValue === 'result'"
      class="diff-mode-button"
      :class="{ 'is-active': props.modelValue === 'result' }"
      :title="t('diff.modeResult')"
      @click="selectMode('result')"
    >
      <Icon
        icon="mdi:file-document-outline"
        class="diff-mode-icon"
        height="15"
      />
      <span class="diff-mode-label">{{ t('diff.modeResult') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import type { DiffViewMode } from '../../lib/diff/diff-model'
import { Icon } from '@iconify/vue'

const props = defineProps<{ modelValue: DiffViewMode }>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: DiffViewMode): void
}>()

const { t } = useI18n()

function selectMode(mode: DiffViewMode) {
  if (props.modelValue !== mode) {
    emit('update:modelValue', mode)
  }
}
</script>

<style scoped>
.diff-mode-toggle {
  display: inline-flex;
  align-items: center;
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  padding: 2px;
  gap: 2px;
  user-select: none;
}

.diff-mode-button {
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

.diff-mode-button:hover:not(.is-active) {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.diff-mode-button.is-active {
  background-color: var(--app-surface-raised);
  color: var(--color-base-content);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.diff-mode-icon {
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .diff-mode-label {
    display: none;
  }
  .diff-mode-button {
    padding: 0.3rem 0.4rem;
  }
}
</style>
