<template>
  <pre class="selectable">{{ text }}</pre>
</template>

<script setup lang="ts">
defineProps<{ text?: string }>()
</script>

<style scoped>
pre {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: var(--space-md) var(--space-lg);
  overflow-y: auto;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.6;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-base-content);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
}
</style>
