<template>
  <div class="field-row" :class="{ vertical: vertical, nested: nested }">
    <div class="field-row-label">
      <div class="field-row-title">
        <template v-if="info || $slots.info">
          <span v-if="labelPrefix">{{ labelPrefix }}</span>
          <span class="field-row-last-word">
            {{ labelSuffix }}
            <InfoTooltip v-if="info" :text="info" />
            <slot name="info" />
          </span>
        </template>
        <span v-else>{{ label }}</span>
      </div>
      <div v-if="hint" class="field-row-hint">{{ hint }}</div>
    </div>
    <div class="field-row-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import InfoTooltip from './InfoTooltip.vue'

const props = defineProps<{
  label: string
  hint?: string
  info?: string
  vertical?: boolean
  nested?: boolean
}>()

const lastWordIndex = computed(() => props.label.lastIndexOf(' '))
const labelPrefix = computed(() =>
  lastWordIndex.value !== -1
    ? props.label.slice(0, lastWordIndex.value + 1)
    : ''
)
const labelSuffix = computed(() =>
  lastWordIndex.value !== -1
    ? props.label.slice(lastWordIndex.value + 1)
    : props.label
)
</script>

<style scoped>
.field-row {
  display: grid;
  grid-template-columns: var(--field-label-width) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
}

.field-row + .field-row {
  border-top: 1px solid var(--app-border-subtle);
}

.nested {
  padding-left: calc(var(--space-lg) + var(--space-md));
}

.nested + .nested {
  border-top: none;
}

.field-row-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 2.25rem;
  justify-content: center;
}

/* Inline, so that the info icon follows the last word of a wrapped label
   instead of being pushed to the end of the column.
   The last word and the info icon are bound into an inline-flex group to prevent
   the icon from being orphaned on a new line alone. */
.field-row-title {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.3;
}

.field-row-last-word {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  white-space: nowrap;
}

.field-row-hint {
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--app-text-muted);
}

.field-row-control {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 2.25rem;
}

.vertical {
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-sm);
}

.vertical .field-row-label {
  min-height: 0;
}

.vertical .field-row-title {
  font-size: 0.8125rem;
}

@media (max-width: 640px) {
  .field-row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-sm);
  }
}
</style>
