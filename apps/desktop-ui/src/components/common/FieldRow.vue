<template>
  <div class="field-row" :class="{ vertical: vertical }">
    <div class="field-row-label">
      <div class="field-row-title">{{ label }}</div>
      <div v-if="hint" class="field-row-hint">{{ hint }}</div>
    </div>
    <div class="field-row-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; hint?: string; vertical?: boolean }>()
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

.field-row-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 2.25rem;
  justify-content: center;
}

.field-row-title {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.3;
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
