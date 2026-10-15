<template>
  <select
    v-bind="controlAttrs()"
    :value="props.options.findIndex((option) => option.id === currentValue)"
    :title="title"
    class="select"
    @change="handleChange"
  >
    <template v-for="(section, index) in sections" :key="index">
      <optgroup v-if="section.label" :label="section.label">
        <option
          v-for="option in section.options"
          :key="option.id"
          :value="props.options.indexOf(option)"
        >
          {{ option.name }}
        </option>
      </optgroup>
      <template v-else>
        <option
          v-for="option in section.options"
          :key="option.id"
          :value="props.options.indexOf(option)"
        >
          {{ option.name }}
        </option>
      </template>
    </template>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()

type Option = { id: number | string; name: string; group?: string }

const props = defineProps<{
  value?: number | string
  modelValue?: number | string
  title?: string
  /** Options of one `group` go under its heading; keep them next to each other */
  options: Option[]
}>()

const emit = defineEmits<{
  (e: 'update:value', value: number | string | undefined): void
  (e: 'update:modelValue', value: number | string | undefined): void
}>()

const currentValue = computed(() =>
  props.modelValue !== undefined ? props.modelValue : props.value
)

const sections = computed(() => {
  const result: { label?: string; options: Option[] }[] = []
  for (const option of props.options) {
    const last = result.at(-1)
    if (last && last.label === option.group) last.options.push(option)
    else result.push({ label: option.group, options: [option] })
  }
  return result
})

function handleChange(event: Event) {
  const select = event.target as HTMLSelectElement
  const option = props.options[select.selectedIndex]
  emit('update:value', option?.id)
  emit('update:modelValue', option?.id)
}
</script>
