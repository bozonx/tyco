<template>
  <div class="parallel-preview">
    <div class="parallel-panes">
      <!-- Left column: Original / Source -->
      <div class="parallel-column">
        <div class="column-header">
          <span class="column-title">
            {{ leftTitle || t('diff.original') }}
          </span>
        </div>
        <div
          ref="leftPaneRef"
          class="column-body selectable"
          @scroll="handleLeftScroll"
        >
          <div class="column-text">{{ props.leftText }}</div>
        </div>
      </div>

      <!-- Right column: Translation / Result -->
      <div class="parallel-column">
        <div class="column-header">
          <span class="column-title">
            {{ rightTitle || t('diff.modified') }}
          </span>
        </div>
        <div
          ref="rightPaneRef"
          class="column-body right-body"
          @scroll="handleRightScroll"
        >
          <textarea
            v-if="props.editable"
            class="column-textarea"
            :value="props.rightText"
            :placeholder="t('diff.modified')"
            @input="handleInput"
          />
          <div v-else class="column-text selectable">
            {{ props.rightText }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../composables/useI18n'

const props = withDefaults(
  defineProps<{
    leftText: string
    rightText: string
    leftTitle?: string
    rightTitle?: string
    editable?: boolean
  }>(),
  { leftTitle: undefined, rightTitle: undefined, editable: true }
)

const emit = defineEmits<{ (e: 'update:rightText', value: string): void }>()

const { t } = useI18n()

const leftPaneRef = ref<HTMLElement | null>(null)
const rightPaneRef = ref<HTMLElement | null>(null)
let isSyncingScroll = false

function handleLeftScroll() {
  if (isSyncingScroll || !leftPaneRef.value || !rightPaneRef.value) return
  isSyncingScroll = true
  rightPaneRef.value.scrollTop = leftPaneRef.value.scrollTop
  requestAnimationFrame(() => {
    isSyncingScroll = false
  })
}

function handleRightScroll() {
  if (isSyncingScroll || !leftPaneRef.value || !rightPaneRef.value) return
  isSyncingScroll = true
  leftPaneRef.value.scrollTop = rightPaneRef.value.scrollTop
  requestAnimationFrame(() => {
    isSyncingScroll = false
  })
}

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:rightText', target.value)
}
</script>

<style scoped>
.parallel-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
}

.parallel-panes {
  display: flex;
  flex-direction: row;
  gap: var(--space-xs);
  flex: 1;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}

.parallel-column {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
  overflow: hidden;
}

.column-header {
  padding: var(--space-xs) var(--space-md);
  background-color: var(--app-surface-sunken);
  border-bottom: 1px solid var(--app-border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.column-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--app-text-muted);
}

.column-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.6;
  padding: var(--space-sm) var(--space-md);
}

.column-text {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-base-content);
}

.right-body {
  display: flex;
  flex-direction: column;
  padding: 0;
}

.column-textarea {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-base-content);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.6;
  padding: var(--space-sm) var(--space-md);
  box-sizing: border-box;
  resize: none;
}

.column-textarea:focus {
  outline: none;
}

@media (max-width: 640px) {
  .parallel-panes {
    flex-direction: column;
  }
}
</style>
