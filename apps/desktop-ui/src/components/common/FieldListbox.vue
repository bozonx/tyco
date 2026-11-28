<template>
  <button
    ref="trigger"
    v-bind="controlAttrs()"
    type="button"
    role="combobox"
    class="select w-full cursor-pointer text-start"
    :aria-expanded="isOpen"
    :aria-controls="isOpen ? listboxId : undefined"
    :aria-activedescendant="isOpen ? optionId(activeIndex) : undefined"
    @blur="close"
    @click="toggle"
    @keydown="onKeydown"
  >
    <span class="truncate">{{ selectedOption?.name }}</span>
  </button>

  <Teleport to="body" :disabled="!canTeleport">
    <MenuSurface
      v-if="isOpen"
      :id="listboxId"
      ref="surface"
      role="listbox"
      :aria-labelledby="controlAttrs()['aria-labelledby']"
      :aria-label="controlAttrs()['aria-label']"
      :data-theme="theme"
      :style="[style, { minWidth: panelMinWidth }]"
      class="field-listbox-panel"
    >
      <div
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="option.id"
        role="option"
        class="field-listbox-option"
        :class="{ 'is-active': index === activeIndex }"
        :aria-selected="option.id === modelValue"
        @mousedown.prevent
        @click="select(index, $event)"
      >
        {{ option.name }}
      </div>
    </MenuSurface>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useFieldControl } from '../../composables/use-field-control'
import type { ControlOption } from '../../lib/ui/control-option'
import MenuSurface from './MenuSurface.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  modelValue: string
  options: ControlOption<string>[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const controlAttrs = useFieldControl()
const trigger = ref<HTMLButtonElement | null>(null)
const surface = ref<InstanceType<typeof MenuSurface> | null>(null)
const listboxId = useId()
const isOpen = ref(false)
const activeIndex = ref(0)
const panelMinWidth = ref('')
const selectedIndex = computed(() =>
  props.options.findIndex((option) => option.id === props.modelValue)
)
const selectedOption = computed(() => props.options[selectedIndex.value])
const canTeleport = computed(() => !trigger.value?.closest('dialog'))
const panel = () => surface.value?.element ?? null

const { style, theme } = useAnchoredPanel({
  isOpen: () => isOpen.value,
  anchor: () => trigger.value,
  panel,
  placement: () => 'bottom',
  align: () => 'start',
})

useDismissibleLayer({
  isOpen: () => isOpen.value,
  elements: () => [trigger.value, panel(), ...(trigger.value?.labels ?? [])],
  dismiss: () => {
    close()
    trigger.value?.blur()
  },
  keydown: (event) => {
    if (event.key === 'Escape') close()
  },
})

function optionId(index: number) {
  return `${listboxId}-option-${index}`
}

function highlight(index: number) {
  activeIndex.value = index
  void nextTick(() => {
    document
      .getElementById(optionId(index))
      ?.scrollIntoView?.({ block: 'nearest' })
  })
}

function open() {
  if (!trigger.value || !props.options.length) return
  panelMinWidth.value = `${trigger.value.getBoundingClientRect().width}px`
  trigger.value.focus({ preventScroll: true })
  isOpen.value = true
  highlight(Math.max(0, selectedIndex.value))
}

function close() {
  isOpen.value = false
}

function toggle(event: MouseEvent) {
  if (!isOpen.value) {
    open()
    return
  }
  close()
  if (event.detail > 0) trigger.value?.blur()
}

function select(index: number, event?: MouseEvent) {
  const option = props.options[index]
  if (option) emit('update:modelValue', option.id)
  close()
  if (event && event.detail > 0) trigger.value?.blur()
}

function onKeydown(event: KeyboardEvent) {
  const { key } = event
  if (key === 'Tab') {
    close()
    return
  }

  const lastIndex = props.options.length - 1
  if (key === 'Enter' || key === ' ') {
    if (isOpen.value) select(activeIndex.value)
    else open()
  } else if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (!isOpen.value) open()
    else if (key === 'ArrowDown')
      highlight(Math.min(lastIndex, activeIndex.value + 1))
    else highlight(Math.max(0, activeIndex.value - 1))
  } else if (isOpen.value && (key === 'Home' || key === 'End')) {
    highlight(key === 'Home' ? 0 : lastIndex)
  } else {
    return
  }
  event.preventDefault()
}
</script>

<style scoped>
.field-listbox-panel {
  max-width: calc(100vw - 1rem);
  max-height: min(15rem, calc(100vh - 1rem));
}

.field-listbox-option {
  padding: 0.375rem var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-control);
  cursor: pointer;
}

.field-listbox-option.is-active,
.field-listbox-option:hover {
  background-color: var(--app-hover);
}

.field-listbox-option[aria-selected='true'] {
  font-weight: 500;
}
</style>
