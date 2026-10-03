<template>
  <div class="action-overlay-layout">
    <!-- Top row: framed text preview / diff / meta and unified header with Esc button -->
    <div class="action-overlay-top">
      <div
        v-if="title || $slots['header-extra'] || escVisible"
        class="action-overlay-header"
      >
        <div class="action-overlay-header-left">
          <h1 v-if="title" class="action-overlay-title">{{ title }}</h1>
          <div v-if="$slots['header-extra']" class="action-overlay-extra">
            <slot name="header-extra" />
          </div>
        </div>

        <button
          v-if="escVisible"
          type="button"
          class="action-overlay-esc"
          @click="handleEsc"
        >
          <KeyButton>Esc</KeyButton>
          <span>{{ escLabel }}</span>
        </button>
      </div>

      <div class="action-overlay-preview-box">
        <slot name="preview">
          <slot />
        </slot>
      </div>
    </div>

    <!-- Bottom row: fixed-height keyboard action block (5x3 grid + system keys) -->
    <div v-if="$slots['actions']" class="action-overlay-bottom">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useOverlayNav } from '../../composables/useOverlayNav'
import KeyButton from './KeyButton.vue'

const props = withDefaults(
  defineProps<{
    title?: string
    escVisible?: boolean
    escMode?: 'close' | 'back' | 'auto'
    escLabel?: string
    onEsc?: () => void
  }>(),
  {
    title: undefined,
    escVisible: true,
    escMode: 'auto',
    escLabel: undefined,
    onEsc: undefined,
  }
)

const { escLabel, handleEsc } = useOverlayNav(() => ({
  escMode: props.escMode,
  escLabel: props.escLabel,
  onEsc: props.onEsc,
}))
</script>

<style scoped>
.action-overlay-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  height: 100%;
  flex: 1 1 0%;
  min-height: 0;
  box-sizing: border-box;
}

.action-overlay-top {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1 1 0%;
  min-height: 0;
}

.action-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-shrink: 0;
  min-height: 1.75rem;
}

.action-overlay-header-left {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-width: 0;
}

.action-overlay-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-base-content);
  line-height: 1.25;
}

.action-overlay-extra {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 0.8125rem;
}

.action-overlay-esc {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0.25rem 0.5rem 0.25rem 0.25rem;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  color: var(--app-text-muted);
  cursor: pointer;
  background: transparent;
  border: none;
  flex-shrink: 0;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.action-overlay-esc:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.action-overlay-preview-box {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  overflow-y: auto;
}

/* Ensure inner TextPreview or Diff expands smoothly without double frames */
.action-overlay-preview-box :deep(pre),
.action-overlay-preview-box :deep(.diff-container) {
  border: none;
  border-radius: 0;
  background-color: transparent;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.action-overlay-bottom {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
</style>
