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
import { ref, computed } from 'vue';
import { diffChars } from 'diff';

// Определяем интерфейс для части diff
interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

const props = defineProps<{
  oldText: string;
  newText: string;
}>();

// Состояние для обработки ошибок
const error = ref<string | null>(null);

// Вычисляем diff с обработкой ошибок
const diffParts = computed<DiffPart[]>(() => {
  try {
    error.value = null;
    
    // Проверяем входные данные
    if (typeof props.oldText !== 'string' || typeof props.newText !== 'string') {
      throw new Error('Both oldText and newText must be strings');
    }
    
    // Вычисляем diff
    const result = diffChars(props.oldText, props.newText);
    return result;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error occurred';
    return [];
  }
});

// Функция для определения CSS класса части diff
const getPartClass = (part: DiffPart): string => {
  if (part.added) return 'added';
  if (part.removed) return 'removed';
  return 'unchanged';
};

</script>

<style scoped>
.diff-container {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  background-color: var(--app-surface-raised);
}

.diff-content {
  display: inline;
}

.error-message {
  color: oklch(var(--er));
  background-color: oklch(var(--er) / 0.1);
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-sm);
  border-left: 3px solid oklch(var(--er));
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
  padding: 1px 3px;
  border-radius: 2px;
  font-weight: 500;
}

.removed {
  background-color: var(--app-diff-removed-bg);
  color: var(--app-diff-removed-fg);
  padding: 1px 3px;
  border-radius: 2px;
  text-decoration: line-through;
  font-weight: 500;
}

.unchanged {
  color: oklch(var(--bc));
}
</style>
