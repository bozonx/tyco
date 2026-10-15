<template>
  <label
    :style="$attrs.style"
    class="input search-input"
    :data-size="size ?? 'md'"
    :class="[$attrs.class, { 'search-input--quiet': quiet }]"
  >
    <Icon icon="mdi:magnify" height="18" class="text-faint shrink-0" />
    <input
      v-bind="controlAttrs()"
      :value="props.modelValue"
      ref="searchInput"
      type="search"
      :placeholder="props.placeholder"
      :aria-label="controlAttrs()['aria-label'] ?? props.placeholder"
      @input="onInput"
    />
  </label>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import { useTextControl } from '../../composables/use-text-control'
import type { ControlSize } from '../../lib/ui/control-types'
import Icon from './AppIcon.vue'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl({ wrapped: true })

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const props = defineProps<{
  size?: ControlSize
  quiet?: boolean
  placeholder?: string

  modelValue?: string
}>()

const searchInput = ref<HTMLInputElement | null>(null)

defineExpose(useTextControl(searchInput))

const onInput = (event: Event) => {
  const newValue = (event.target as HTMLInputElement).value

  emit('update:modelValue', newValue)
}
</script>

<style scoped>
.search-input {
  width: 100%;
}

.search-input--quiet:not(:focus-within) {
  border-color: transparent;
}
</style>
