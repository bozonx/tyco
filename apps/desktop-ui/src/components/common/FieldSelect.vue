<template>
  <select
    v-bind="controlAttrs()"
    :value="props.options.findIndex((option) => option.id === props.modelValue)"
    :title="title"
    class="select"
    :data-size="size ?? 'md'"
    @change="handleChange"
  >
    <template v-for="(section, index) in sections" :key="index">
      <optgroup v-if="section.label" :label="section.label">
        <option
          v-for="entry in section.options"
          :key="entry.index"
          :value="entry.index"
          :disabled="entry.option.disabled"
        >
          {{ entry.option.name }}
        </option>
      </optgroup>
      <template v-else>
        <option
          v-for="entry in section.options"
          :key="entry.index"
          :value="entry.index"
          :disabled="entry.option.disabled"
        >
          {{ entry.option.name }}
        </option>
      </template>
    </template>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import type { ControlOption } from '../../lib/ui/control-option'
import type { ControlSize } from '../../lib/ui/control-types'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()

type Option = ControlOption & { group?: string; disabled?: boolean }

const props = defineProps<{
  size?: ControlSize
  modelValue?: number | string
  title?: string
  /** Options of one `group` go under its heading; keep them next to each other */
  options: Option[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | string | undefined): void
}>()

const sections = computed(() => {
  const result: {
    label?: string
    options: { option: Option; index: number }[]
  }[] = []
  for (const [index, option] of props.options.entries()) {
    const last = result.at(-1)
    if (last && last.label === option.group)
      last.options.push({ option, index })
    else result.push({ label: option.group, options: [{ option, index }] })
  }
  return result
})

function handleChange(event: Event) {
  const select = event.target as HTMLSelectElement
  const option = props.options[select.selectedIndex]

  emit('update:modelValue', option?.id)
}
</script>
