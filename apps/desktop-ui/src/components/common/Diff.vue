<template>
  <div class="diff-container">
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
    <div v-else-if="diffParts.length === 0" class="no-diff">
      No differences found
    </div>
    <div v-else class="diff-content">
      <span
        v-for="(part, index) in diffParts"
        :key="`diff-${index}-${part.added}-${part.removed}`"
        :class="getPartClass(part)"
      >
        {{ part.value }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { diffChars } from 'diff'
import { computed } from 'vue'

// Определяем интерфейс для части diff
interface DiffPart {
  value: string
  added?: boolean
  removed?: boolean
}

const props = defineProps<{ oldText: string; newText: string }>()

const diffResult = computed<{ parts: DiffPart[]; error: string | null }>(() => {
  try {
    if (
      typeof props.oldText !== 'string' ||
      typeof props.newText !== 'string'
    ) {
      throw new Error('Both oldText and newText must be strings')
    }
    return { parts: diffChars(props.oldText, props.newText), error: null }
  } catch (err) {
    return {
      parts: [],
      error: err instanceof Error ? err.message : 'Unknown error occurred',
    }
  }
})

const diffParts = computed<DiffPart[]>(() => diffResult.value.parts)
const error = computed<string | null>(() => diffResult.value.error)

// Функция для определения CSS класса части diff
const getPartClass = (part: DiffPart): string => {
  if (part.added) return 'added'
  if (part.removed) return 'removed'
  return 'unchanged'
}
</script>

<style scoped>
.diff-container {
  font-size: 0.9375rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-md) var(--space-lg);
  background-color: var(--app-surface-raised);
}

.diff-content {
  display: inline;
}

.error-message {
  color: var(--color-error);
  background-color: color-mix(in oklab, var(--color-error) 10%, transparent);
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--color-error);
  font-weight: 500;
}

.no-diff {
  color: var(--app-text-muted);
  font-style: italic;
  text-align: center;
  padding: var(--space-3xl);
}

.added {
  background-color: var(--app-diff-added-bg);
  color: var(--app-diff-added-fg);
  padding: 1px 2px;
  border-radius: 3px;
}

.removed {
  background-color: var(--app-diff-removed-bg);
  color: var(--app-diff-removed-fg);
  padding: 1px 2px;
  border-radius: 3px;
  text-decoration: line-through;
}

.unchanged {
  color: var(--color-base-content);
}
</style>
