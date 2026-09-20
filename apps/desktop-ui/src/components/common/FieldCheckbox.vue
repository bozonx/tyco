<template>
  <label class="label">
    <input
      type="checkbox"
      :checked="value"
      @change="handleChange"
      class="checkbox"
    />
    {{ label }}
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{ value: boolean; label?: string }>()

const emit = defineEmits<{ (e: 'update:value', value: boolean): void }>()

function handleChange() {
  emit('update:value', !props.value)
}
</script>
