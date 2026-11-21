<template>
  <section
    ref="pickerRef"
    class="voice-param-picker"
    :aria-label="parameterLabel"
    tabindex="-1"
    @keydown="onPickerKeyDown"
    @scroll="onPickerScroll"
  >
    <div class="voice-param-grid">
      <button
        v-for="(option, index) in options"
        :key="option.id"
        :ref="(el) => setOptionRef(index, el)"
        type="button"
        class="voice-param-option"
        :class="{
          'is-selected': option.id === selectedValue,
          'is-focused': index === selectedIndex,
        }"
        @click="emit('pick', option.id)"
        @mouseenter="selectedIndex = index"
      >
        <div class="voice-param-option-top">
          <KeyboardKey
            v-if="hasShortcut(index, pageStart, PAGE)"
            class="voice-param-slot-key"
          >
            {{ SHORTCUT_SLOT_KEYS[index - pageStart]?.toUpperCase() }}
          </KeyboardKey>
          <span v-else class="voice-param-slot-index">#{{ index + 1 }}</span>
          <span class="voice-param-option-name">{{ option.name }}</span>
        </div>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  hasShortcut,
  shiftWindow,
  shortcutTarget,
  windowStartAtScroll,
} from '../../lib/shortcut-grid/shortcut-pages'
import KeyboardKey from '../common/KeyboardKey.vue'
import { SHORTCUT_SLOT_KEYS, type ShortcutSlotKey } from '@tyco/shared'

const COLUMNS = 5
const ROWS = 3
const PAGE = COLUMNS * ROWS

const props = defineProps<{
  parameterLabel: string
  options: readonly { id: string; name: string }[]
  selectedValue?: string
}>()

const emit = defineEmits<{ pick: [value: string]; back: [] }>()

const pickerRef = ref<HTMLElement | null>(null)
const pageStart = ref(0)
const selectedIndex = ref(0)
const optionRefs = ref<Record<number, HTMLElement | null>>({})

const setOptionRef = (index: number, el: unknown) => {
  if (el) optionRefs.value[index] = el as HTMLElement
  else delete optionRefs.value[index]
}

const gridWindow = computed(() => ({
  columns: COLUMNS,
  size: PAGE,
  count: props.options.length,
}))

function onPickerScroll() {
  const grid = pickerRef.value
  const first = optionRefs.value[0]
  const nextRow = optionRefs.value[COLUMNS]
  if (!grid || !first) return
  const rowHeight = nextRow
    ? nextRow.offsetTop - first.offsetTop
    : first.offsetHeight
  const start = windowStartAtScroll(grid.scrollTop, rowHeight, gridWindow.value)
  if (start !== pageStart.value) {
    pageStart.value = start
  }
}

function isPlainKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey
}

function slotOf(event: KeyboardEvent): number {
  const codeLetter =
    event.code.length === 4 && event.code.startsWith('Key')
      ? event.code.slice(3).toLowerCase()
      : undefined
  const letter = (codeLetter || event.key.toLowerCase()) as ShortcutSlotKey
  return SHORTCUT_SLOT_KEYS.indexOf(letter)
}

function pickBySlot(event: KeyboardEvent): boolean {
  if (!isPlainKey(event)) return false
  const target = shortcutTarget(
    slotOf(event),
    pageStart.value,
    props.options.length
  )
  if (target === undefined) return false
  const opt = props.options[target]
  if (!opt) return false
  emit('pick', opt.id)
  return true
}

const onPickerKeyDown = (event: KeyboardEvent) => {
  if (event.isComposing) return
  const count = props.options.length
  if (count === 0) return

  const rows = [
    ...(pickerRef.value?.querySelectorAll<HTMLButtonElement>(
      '.voice-param-option'
    ) ?? []),
  ]
  const index = rows.indexOf(document.activeElement as HTMLButtonElement)

  const moves: Record<string, () => number | undefined> = {
    ArrowRight: () => (index + 1 < count ? index + 1 : undefined),
    ArrowLeft: () => (index > 0 ? index - 1 : undefined),
    ArrowDown: () =>
      index + COLUMNS < count
        ? index + COLUMNS
        : index < count - 1
          ? count - 1
          : undefined,
    ArrowUp: () => (index >= COLUMNS ? index - COLUMNS : undefined),
    PageDown: () => {
      const next = shiftWindow(pageStart.value, 1, gridWindow.value)
      pageStart.value = next
      optionRefs.value[next]?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
      return next
    },
    PageUp: () => {
      const prev = shiftWindow(pageStart.value, -1, gridWindow.value)
      pageStart.value = prev
      optionRefs.value[prev]?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
      return prev
    },
    Home: () => 0,
    End: () => count - 1,
  }

  const move = moves[event.key]
  if (move) {
    event.preventDefault()
    const target = move()
    if (target !== undefined) {
      selectedIndex.value = target
      rows[target]?.focus()
      rows[target]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    return
  }

  if (pickBySlot(event)) {
    event.preventDefault()
  }
}

defineExpose({ pickBySlot, pageStart })
</script>

<style scoped>
.voice-param-picker {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-xs);
  outline: none;
}

.voice-param-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-xs);
}

.voice-param-option {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0.375rem var(--space-xs);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background: var(--quick-tile-bg, transparent);
  color: var(--color-base-content);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.voice-param-option:hover,
.voice-param-option.is-focused {
  background-color: var(--app-hover);
}

.voice-param-option:focus-visible {
  outline: none;
  box-shadow: var(--app-focus-ring);
}

.voice-param-option.is-selected {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  background-color: color-mix(in oklab, var(--color-primary) 12%, transparent);
}

.voice-param-option-top {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.voice-param-slot-key {
  --key-size: 1.125rem;
  --key-font-size: var(--text-nano);
  flex-shrink: 0;
}

.voice-param-slot-index {
  font-family: var(--font-mono);
  font-size: var(--text-nano);
  color: var(--app-text-faint);
  min-width: 1.125rem;
}

.voice-param-option-name {
  font-size: var(--text-caption);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@container (max-width: 680px) {
  .voice-param-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@container (max-width: 480px) {
  .voice-param-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
