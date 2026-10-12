<template>
  <button
    type="button"
    :role="navigation ? undefined : 'tab'"
    class="app-tab"
    :class="{ 'is-active': active }"
    :aria-selected="navigation ? undefined : active"
    :aria-current="navigation && active ? 'page' : undefined"
  >
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
defineProps<{ active?: boolean; navigation?: boolean }>()
</script>
