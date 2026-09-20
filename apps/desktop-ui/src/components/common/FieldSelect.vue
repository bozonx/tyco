<template>
  <select
    :value="props.value"
    :title="title"
    :disabled="props.disabled"
    class="select"
    @change="handleChange"
  >
    <option
      v-for="option in options"
      :key="option.id"
      :value="option.id"
      :selected="option.id === props.value"
    >
      {{ option.name }}
    </option>
  </select>
</template>

<script setup lang="ts">
const props = defineProps<{
  value?: number | string
  title?: string
  disabled?: boolean
  options: { id: number | string; name: string }[]
}>()

const emit = defineEmits<{
  (e: 'update:value', value: number | string | undefined): void
}>()

function handleChange(event: Event) {
  emit('update:value', (event.target as HTMLSelectElement).value)
}
</script>
