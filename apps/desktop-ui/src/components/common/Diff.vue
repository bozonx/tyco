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
      <SplitPanePreview
        v-else
        class="diff-panes"
        :left-title="t('diff.original')"
        :right-title="t('diff.modified')"
      >
        <template #left>
          <span
            v-for="(part, index) in splitResult.oldParts"
            :key="`old-${index}`"
            :class="part.removed ? 'removed' : 'unchanged'"
            >{{ part.value }}</span
          >
        </template>
        <template #right>
          <span
            v-for="(part, index) in splitResult.newParts"
            :key="`new-${index}`"
            :class="part.added ? 'added' : 'unchanged'"
            >{{ part.value }}</span
          >
        </template>
      </SplitPanePreview>
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
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type DiffPart,
  type DiffViewMode,
  computeWordDiff,
  hasDifferences,
  readStoredDiffMode,
  splitDiffParts,
} from '../../lib/diff/diff-model'
import SplitPanePreview from './SplitPanePreview.vue'

const props = defineProps<{
  oldText: string
  newText: string
  mode?: DiffViewMode
}>()

const { t } = useI18n()

const effectiveMode = computed<DiffViewMode>(() => {
  return props.mode ?? readStoredDiffMode()
})

const diffData = computed<{
  unified: DiffPart[]
  split: { oldParts: DiffPart[]; newParts: DiffPart[] }
  error: string | null
}>(() => {
  try {
    if (effectiveMode.value === 'result') {
      return { unified: [], split: { oldParts: [], newParts: [] }, error: null }
    }
    if (
      typeof props.oldText !== 'string' ||
      typeof props.newText !== 'string'
    ) {
      throw new Error('Both oldText and newText must be strings')
    }
    const unified = computeWordDiff(props.oldText, props.newText)
    const split = splitDiffParts(unified)
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

.diff-panes {
  padding: var(--space-xs);
}

.diff-split-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
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
</style>
