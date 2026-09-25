<template>
  <div class="diff-container" :class="`mode-${effectiveMode}`">
    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <!-- Mode: Clean Result -->
    <div v-else-if="effectiveMode === 'result'" class="diff-result-view">
      <div class="diff-text-block">
        {{ props.newText }}
      </div>
    </div>

    <!-- Mode: Split (Side by Side) -->
    <div v-else-if="effectiveMode === 'split'" class="diff-split-view">
      <div v-if="!hasDiff" class="no-diff">
        {{ t('diff.noDiff') }}
      </div>
      <div v-else class="diff-split-panes">
        <div class="diff-split-column">
          <div class="diff-column-header">
            <span class="diff-column-title">{{ t('diff.original') }}</span>
          </div>
          <div
            ref="leftPaneRef"
            class="diff-column-body"
            @scroll="handleLeftScroll"
          >
            <span
              v-for="(part, index) in splitResult.oldParts"
              :key="`old-${index}`"
              :class="part.removed ? 'removed' : 'unchanged'"
            >
              {{ part.value }}
            </span>
          </div>
        </div>

        <div class="diff-split-column">
          <div class="diff-column-header">
            <span class="diff-column-title">{{ t('diff.modified') }}</span>
          </div>
          <div
            ref="rightPaneRef"
            class="diff-column-body"
            @scroll="handleRightScroll"
          >
            <span
              v-for="(part, index) in splitResult.newParts"
              :key="`new-${index}`"
              :class="part.added ? 'added' : 'unchanged'"
            >
              {{ part.value }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Mode: Unified (Inline) -->
    <div v-else class="diff-unified-view">
      <div v-if="!hasDiff" class="no-diff">
        {{ t('diff.noDiff') }}
      </div>
      <div v-else class="diff-content">
        <span
          v-for="(part, index) in unifiedParts"
          :key="`diff-${index}-${part.added}-${part.removed}`"
          :class="getPartClass(part)"
        >
          {{ part.value }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  type DiffPart,
  type DiffViewMode,
  computeSplitDiff,
  computeWordDiff,
  hasDifferences,
  readStoredDiffMode,
} from '../../lib/diff/diff-model'

const props = defineProps<{
  oldText: string
  newText: string
  mode?: DiffViewMode
}>()

const { t } = useI18n()

const effectiveMode = computed<DiffViewMode>(() => {
  return props.mode ?? readStoredDiffMode()
})

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

const diffData = computed<{
  unified: DiffPart[]
  split: { oldParts: DiffPart[]; newParts: DiffPart[] }
  error: string | null
}>(() => {
  try {
    if (
      typeof props.oldText !== 'string' ||
      typeof props.newText !== 'string'
    ) {
      throw new Error('Both oldText and newText must be strings')
    }
    const unified = computeWordDiff(props.oldText, props.newText)
    const split = computeSplitDiff(props.oldText, props.newText)
    return { unified, split, error: null }
  } catch (err) {
    return {
      unified: [],
      split: { oldParts: [], newParts: [] },
      error: err instanceof Error ? err.message : 'Unknown error occurred',
    }
  }
})

const unifiedParts = computed<DiffPart[]>(() => diffData.value.unified)
const splitResult = computed(() => diffData.value.split)
const error = computed<string | null>(() => diffData.value.error)
const hasDiff = computed<boolean>(() => hasDifferences(unifiedParts.value))

function getPartClass(part: DiffPart): string {
  if (part.added) return 'added'
  if (part.removed) return 'removed'
  return 'unchanged'
}
</script>

<style scoped>
.diff-container {
  font-size: 0.9375rem;
  line-height: 1.6;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface-raised);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 0;
}

.diff-unified-view,
.diff-result-view {
  padding: var(--space-md) var(--space-lg);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.diff-content,
.diff-text-block {
  display: inline;
}

.diff-split-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.diff-split-panes {
  display: flex;
  flex-direction: row;
  gap: var(--space-xs);
  flex: 1;
  min-height: 0;
  height: 100%;
  padding: var(--space-xs);
  box-sizing: border-box;
}

.diff-split-column {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
  overflow: hidden;
}

.diff-column-header {
  padding: var(--space-xs) var(--space-md);
  background-color: var(--app-surface-sunken);
  border-bottom: 1px solid var(--app-border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.diff-column-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--app-text-muted);
}

.diff-column-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-sm) var(--space-md);
  white-space: pre-wrap;
  word-break: break-word;
}

.error-message {
  color: var(--color-error);
  background-color: color-mix(in oklab, var(--color-error) 10%, transparent);
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--color-error);
  font-weight: 500;
  margin: var(--space-md);
}

.no-diff {
  color: var(--app-text-muted);
  font-style: italic;
  text-align: center;
  padding: var(--space-3xl);
  margin: auto;
}

.added {
  background-color: var(--app-diff-added-bg);
  color: var(--app-diff-added-fg);
  text-decoration: var(--app-diff-added-decoration);
  padding: 1px 3px;
  border-radius: 3px;
}

.removed {
  background-color: var(--app-diff-removed-bg);
  color: var(--app-diff-removed-fg);
  padding: 1px 3px;
  border-radius: 3px;
  text-decoration: line-through;
  opacity: 0.85;
}

.unchanged {
  color: var(--color-base-content);
}

@media (max-width: 640px) {
  .diff-split-panes {
    flex-direction: column;
  }
}
</style>
