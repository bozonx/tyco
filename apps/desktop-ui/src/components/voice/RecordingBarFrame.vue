<template>
  <div class="voice-bar" role="region" :aria-label="label"><slot /></div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<style scoped>
.voice-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
  padding: var(--space-sm);
  box-sizing: border-box;
  border: 1px solid color-mix(in oklab, var(--color-primary) 45%, transparent);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-md);
}
</style>
