<template>
  <label :class="$attrs.class" :style="$attrs.style" class="input search-input">
    <Icon icon="mdi:magnify" height="18" class="text-faint shrink-0" />
    <input
      v-bind="controlAttrs()"
      :value="currentValue"
      ref="searchInput"
      type="search"
      :placeholder="props.placeholder"
      :aria-label="controlAttrs()['aria-label'] ?? props.placeholder"
      @input="onInput"
    />
  </label>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import Icon from './AppIcon.vue'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl({ wrapped: true })

const emit = defineEmits<{
  (e: 'update:value', value: string): void
  (e: 'update:modelValue', value: string): void
}>()

const props = defineProps<{
  placeholder?: string
  value?: string
  modelValue?: string
}>()

const currentValue = computed(() =>
  props.modelValue !== undefined ? props.modelValue : props.value
)

const searchInput = ref<HTMLInputElement | null>(null)

const focus = () => {
  if (searchInput.value) {
    searchInput.value.focus()
  }
}

defineExpose({ focus })

const onInput = (event: Event) => {
  const newValue = (event.target as HTMLInputElement).value
  emit('update:value', newValue)
  emit('update:modelValue', newValue)
}
</script>

<style scoped>
.search-input {
  width: 100%;
}
</style>
