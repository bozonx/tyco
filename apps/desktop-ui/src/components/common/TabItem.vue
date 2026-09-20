<template>
  <a role="tab" class="tab" :class="tabClass">
    <slot></slot>
  </a>
</template>

<script setup lang="ts">
  import { computed } from "vue";

  const props = defineProps<{
    active?: boolean;
  }>();

  const tabClass = computed(() => {
    return {
      "tab-active": props.active,
    };
  });
</script>
