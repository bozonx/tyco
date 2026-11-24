<template>
  <button type="button" class="inline-action" @pointerdown="preventMouseFocus">
    <slot />
  </button>
</template>
<script setup lang="ts">
import { preventMouseFocus } from '../../lib/ui/focus'
</script>
<style scoped>
.inline-action {
  display: inline;
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.inline-action:hover {
  color: var(--color-base-content);
}
</style>
