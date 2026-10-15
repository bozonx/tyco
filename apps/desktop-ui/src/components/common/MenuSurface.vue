<template>
  <div ref="element" role="menu" class="menu-surface"><slot /></div>
</template>
<script setup lang="ts">
import { ref } from 'vue'

const element = ref<HTMLDivElement | null>(null)
defineExpose({ element })
</script>
<style scoped>
.menu-surface {
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  padding: var(--space-xs);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  background-color: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-lg);
}
</style>
