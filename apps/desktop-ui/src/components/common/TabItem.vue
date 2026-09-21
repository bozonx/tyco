<template>
  <button
    type="button"
    role="tab"
    class="app-tab"
    :class="{ 'is-active': active }"
    :aria-selected="active ? 'true' : 'false'"
  >
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
defineProps<{ active?: boolean }>()
</script>
