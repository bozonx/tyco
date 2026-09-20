<template>
  <div class="field-row" :class="{ vertical: vertical }">
    <div class="field-row-label text-muted">
      {{ label }}
    </div>
    <div class="flex-1">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; vertical?: boolean }>()
</script>

<style scoped>
.field-row {
  display: flex;
  flex-direction: row;
  gap: 14px;
  padding: var(--space-md) var(--space-sm);
}

.field-row-label {
  width: var(--field-label-width);
  text-align: right;
  line-height: 2rem;
  font-size: 0.8125rem;
  font-weight: 500;
}

.vertical {
  flex-direction: column;
  gap: 0px;
}

.vertical .field-row-label {
  text-align: left;
  font-size: 0.75rem;
  line-height: 1.125rem;
}
</style>
