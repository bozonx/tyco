<template>
  <pre class="selectable">{{ text }}</pre>
</template>

<script setup lang="ts">
defineProps<{
  text?: string;
}>()
</script>

<style scoped>
pre {
  text-align: left;
  padding: var(--space-lg);
  height: 100%;
  width: 100%;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--app-surface-raised);
  border-radius: var(--radius-md);
  border: 1px solid var(--app-border);
  color: oklch(var(--bc));
}
</style>
