<template>
  <button
    ref="trigger"
    v-bind="controlAttrs()"
    type="button"
    role="combobox"
    class="select field-select-trigger"
    :title="title"
    :data-size="size ?? 'md'"
    :aria-expanded="isOpen"
    :aria-controls="isOpen ? listboxId : undefined"
    :aria-activedescendant="
      isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined
    "
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
      class="field-select-panel"
    >
      <div
        v-for="(section, sectionIndex) in sections"
        :key="sectionIndex"
        :role="section.label ? 'group' : 'presentation'"
        :aria-label="section.label"
      >
        <div
          v-if="section.label"
          class="field-select-group-label"
          aria-hidden="true"
        >
          {{ section.label }}
        </div>
        <div
          v-for="{ option, index } in section.options"
          :id="optionId(index)"
          :key="index"
          role="option"
          class="field-select-option"
          :class="{ 'is-active': index === activeIndex }"
          :aria-selected="index === selectedIndex"
          :aria-disabled="option.disabled || undefined"
          @mousedown.prevent
          @click.prevent="select(index, $event)"
        >
          {{ option.name }}
        </div>
      </div>
    </MenuSurface>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useFieldControl } from '../../composables/use-field-control'
import type { ControlOption } from '../../lib/ui/control-option'
import type { ControlSize } from '../../lib/ui/control-types'
import MenuSurface from './MenuSurface.vue'

defineOptions({ inheritAttrs: false })
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

const fieldAttrs = useFieldControl()
function controlAttrs() {
  const { required, ...attrs } = fieldAttrs()
  return { ...attrs, 'aria-required': required || undefined }
}

const trigger = ref<HTMLButtonElement | null>(null)
const surface = ref<InstanceType<typeof MenuSurface> | null>(null)
const listboxId = useId()
const isOpen = ref(false)
const activeIndex = ref(-1)
const panelMinWidth = ref('')
let searchPrefix = ''
let lastSearchTime = 0
const selectedIndex = computed(() =>
  props.options.findIndex((option) => option.id === props.modelValue)
)
const enabledIndices = computed(() =>
  props.options.flatMap((option, index) => (option.disabled ? [] : [index]))
)
const selectedOption = computed(() => props.options[selectedIndex.value])
const canTeleport = computed(() => !trigger.value?.closest('dialog'))
const panel = () => surface.value?.element ?? null

watch(
  [enabledIndices, () => controlAttrs().disabled],
  ([indices, disabled]) => {
    if (!isOpen.value) return
    if (disabled || !props.options.length) close()
    else if (!indices.includes(activeIndex.value)) highlightInitialOption()
  }
)

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
    const list = panel()
    const option = document.getElementById(optionId(index))
    if (!list || !option) return
    const listBounds = list.getBoundingClientRect()
    const optionBounds = option.getBoundingClientRect()
    if (optionBounds.top < listBounds.top)
      list.scrollTop += optionBounds.top - listBounds.top
    else if (optionBounds.bottom > listBounds.bottom)
      list.scrollTop += optionBounds.bottom - listBounds.bottom
  })
}

function open() {
  if (!trigger.value || trigger.value.disabled || !props.options.length) return
  panelMinWidth.value = `min(${trigger.value.getBoundingClientRect().width}px, calc(100vw - 1rem))`
  trigger.value.focus({ preventScroll: true })
  isOpen.value = true
  highlightInitialOption()
}

function highlightInitialOption() {
  const indices = enabledIndices.value
  highlight(
    indices.includes(selectedIndex.value)
      ? selectedIndex.value
      : (indices[0] ?? -1)
  )
}

function close() {
  isOpen.value = false
  searchPrefix = ''
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
  if (!option || option.disabled) return
  if (option.id !== props.modelValue) emit('update:modelValue', option.id)
  close()
  if (event && event.detail > 0) trigger.value?.blur()
}

function searchOptions(key: string, timeStamp: number) {
  const letter = key.toLocaleLowerCase()
  const previous = timeStamp - lastSearchTime < 700 ? searchPrefix : ''
  const prefix = previous === letter ? letter : previous + letter
  const indices = enabledIndices.value
  const current = indices.indexOf(activeIndex.value)
  const start = prefix.length === 1 ? current + 1 : Math.max(0, current)
  const ordered = [...indices.slice(start), ...indices.slice(0, start)]
  const match = ordered.find((index) =>
    props.options[index].name.toLocaleLowerCase().startsWith(prefix)
  )
  searchPrefix = prefix
  lastSearchTime = timeStamp
  if (match !== undefined) highlight(match)
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
    return
  const { key } = event
  if (key === 'Tab') {
    close()
    return
  }

  const indices = enabledIndices.value
  const lastIndex = indices.length - 1
  if (key === 'Enter' || key === ' ') {
    if (isOpen.value) select(activeIndex.value)
    else open()
  } else if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (!isOpen.value) open()
    else {
      const offset = key === 'ArrowDown' ? 1 : -1
      const current = indices.indexOf(activeIndex.value)
      const next = Math.max(0, Math.min(lastIndex, current + offset))
      highlight(indices[next] ?? -1)
    }
  } else if (isOpen.value && (key === 'Home' || key === 'End')) {
    highlight(indices[key === 'Home' ? 0 : lastIndex] ?? -1)
  } else if (key.length === 1) {
    if (!isOpen.value) open()
    searchOptions(key, event.timeStamp)
  } else {
    return
  }
  event.preventDefault()
}
</script>

<style scoped>
.field-select-trigger {
  max-width: 100%;
  cursor: pointer;
  text-align: start;
}

.field-select-group-label {
  padding: 0.25rem var(--space-sm);
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  font-weight: 500;
}

.field-select-panel {
  max-width: calc(100vw - 1rem);
  max-height: min(15rem, calc(100vh - 1rem));
}

.field-select-option {
  padding: 0.375rem var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-control);
  cursor: pointer;
}

.field-select-option.is-active,
.field-select-option:hover:not([aria-disabled='true']) {
  background-color: var(--app-hover);
}

.field-select-option[aria-disabled='true'] {
  color: var(--app-text-faint);
  cursor: not-allowed;
}

.field-select-option[aria-selected='true'] {
  font-weight: 500;
}
</style>
