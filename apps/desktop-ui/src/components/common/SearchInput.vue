<template>
  <label class="input search-input">
    <Icon icon="mdi:magnify" height="18" class="text-faint shrink-0" />
    <input
      :value="modelValue"
      ref="searchInput"
      type="search"
      :placeholder="props.placeholder"
      @input="onInput"
    />
  </label>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { Icon } from '@iconify/vue'

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const props = defineProps<{ placeholder?: string; modelValue?: string }>()

const searchInput = ref<HTMLInputElement | null>(null)

const focus = () => {
  if (searchInput.value) {
    searchInput.value.focus()
  }
}

defineExpose({ focus })

const onInput = (event: Event) => {
  const newValue = (event.target as HTMLInputElement).value
  emit('update:modelValue', newValue)
}
</script>

<style scoped>
.search-input {
  width: 100%;
}
</style>
