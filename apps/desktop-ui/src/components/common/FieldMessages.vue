<template>
  <div v-if="errors.length" :id="errorId" class="field-row-error" role="alert">
    <p v-for="(message, index) in errors" :key="index">{{ message }}</p>
  </div>
  <div
    v-if="warnings.length || $slots.default"
    :id="warningId"
    class="field-row-warning"
  >
    <p v-for="(message, index) in warnings" :key="index">{{ message }}</p>
    <slot />
  </div>
</template>
<script setup lang="ts">
defineProps<{
  errors: string[]
  warnings: string[]
  errorId: string
  warningId: string
}>()
</script>
<style scoped>
.field-row-error {
  color: var(--color-error);
  font-size: var(--text-caption);
}
.field-row-warning {
  color: var(--color-warning);
  font-size: var(--text-caption);
}
p {
  margin: 0;
}
</style>
