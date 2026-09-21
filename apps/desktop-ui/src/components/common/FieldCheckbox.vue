<template>
  <label class="field-checkbox">
    <input
      type="checkbox"
      :checked="value"
      @change="handleChange"
      class="toggle toggle-primary toggle-sm"
    />
    <span v-if="label" class="field-checkbox-label">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{ value: boolean; label?: string }>()

const emit = defineEmits<{ (e: 'update:value', value: boolean): void }>()

function handleChange() {
  emit('update:value', !props.value)
}
</script>

<style scoped>
.field-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.field-checkbox-label {
  color: var(--app-text-muted);
}
</style>
