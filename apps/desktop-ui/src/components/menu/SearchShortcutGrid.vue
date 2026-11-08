<template>
  <div
    class="search-grid"
    :class="{ 'is-dense': props.dense, 'is-tall': props.tall }"
  >
    <div class="search-grid-search-row">
      <AppIcon icon="mdi:magnify" size="md" class="search-grid-search-icon" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        class="search-grid-search-input"
        :placeholder="props.placeholder"
        :aria-label="props.placeholder"
        spellcheck="false"
        autocomplete="off"
        @focus="isSearchFocused = true"
        @blur="isSearchFocused = false"
        @keydown="onSearchKeyDown"
      />
      <div class="search-grid-search-extra">
        <span
          v-if="pageCount > 1"
          class="search-grid-page"
          data-testid="search-grid-page"
          >{{ currentPage }} / {{ pageCount }}</span
        >
        <button
          v-if="query"
          type="button"
          class="search-grid-search-clear"
          :aria-label="t('editor.clear')"
          @click="clearQuery"
        >
          <AppIcon icon="mdi:close" size="sm" />
        </button>
        <KeyboardKey
          v-else-if="!isSearchFocused && !props.dense"
          class="search-grid-search-hint"
          >Ctrl+F</KeyboardKey
        >
      </div>
    </div>

    <div
      v-if="props.items.length > 0"
      ref="gridRef"
      class="search-grid-grid"
      tabindex="-1"
      role="grid"
      @keydown="onGridKeyDown"
      @scroll="onGridScroll"
    >
      <div
        v-for="(item, index) in props.items"
        :key="item.id"
        :ref="(el) => setItemRef(index, el)"
        role="row"
        class="search-grid-cell"
        :class="{
          'is-selected': index === selectedIndex,
          'is-page-start': index % PAGE === 0,
        }"
        :aria-selected="index === selectedIndex"
        @click="emit('select', item)"
        @mouseenter="selectedIndex = index"
      >
        <div class="search-grid-cell-top">
          <KeyboardKey
            v-if="hasShortcut(index, pageStart, PAGE)"
            class="search-grid-slot-key"
          >
            {{ SHORTCUT_SLOT_KEYS[index - pageStart]?.toUpperCase() }}
          </KeyboardKey>
          <span v-else class="search-grid-slot-index">#{{ index + 1 }}</span>
          <slot name="title" :item="item" :index="index" />
        </div>
        <slot name="item" :item="item" :index="index" />
      </div>
    </div>
    <div v-else class="search-grid-empty">
      {{ props.emptyText }}
    </div>
  </div>
</template>

<script setup lang="ts" generic="T extends { id: string }">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  hasShortcut,
  pageCountOf,
  pageStartAtScroll,
  pageStartOf,
  shortcutTarget,
} from '../../lib/shortcut-grid/shortcut-pages'
import AppIcon from '../common/AppIcon.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import { SHORTCUT_SLOT_KEYS, type ShortcutSlotKey } from '@tyco/shared'

/**
 * A searched grid of items. The grid has the focus at first: the shortcut keys
 * pick the items of the current page, the arrows move, PageUp/PageDown and
 * scrolling switch pages. Ctrl+F, `/` or another letter go to the search; there
 * Alt with a shortcut key still picks, and Escape clears the query, then
 * returns to the grid.
 */
const props = withDefaults(
  defineProps<{
    items: readonly T[]
    placeholder: string
    emptyText: string
    shortcutsDisabled?: boolean
    /** Smaller cells, e.g. in a popover */
    dense?: boolean
    /** Taller cells filling the available height */
    tall?: boolean
  }>(),
  { shortcutsDisabled: false, dense: false, tall: false }
)

const query = defineModel<string>('query', { default: '' })

const emit = defineEmits<{
  (e: 'select', item: T): void
  /** Escape, with Shift held or not */
  (e: 'escape', isShifted: boolean): void
}>()

const { t } = useI18n()

const COLUMNS = 5
const PAGE = SHORTCUT_SLOT_KEYS.length

const selectedIndex = ref(0)
const pageStart = ref(0)
const isSearchFocused = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const gridRef = ref<HTMLDivElement | null>(null)
const itemRefs = ref<(HTMLElement | null)[]>([])

const pageCount = computed(() => pageCountOf(props.items.length, PAGE))
const currentPage = computed(() => pageStart.value / PAGE + 1)

const setItemRef = (index: number, el: unknown) => {
  itemRefs.value[index] = el as HTMLElement | null
}

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
    pageStart.value = 0
    gridRef.value?.scrollTo?.({ top: 0 })
  }
)

function select(index: number) {
  const item = props.items[index]
  if (item) emit('select', item)
}

function showPage(start: number) {
  if (start === pageStart.value) return
  pageStart.value = start
  void nextTick(() => {
    itemRefs.value[start]?.scrollIntoView?.({
      block: 'start',
      inline: 'nearest',
    })
  })
}

function moveTo(index: number) {
  selectedIndex.value = index
  showPage(pageStartOf(index, PAGE))
  void nextTick(() => {
    itemRefs.value[index]?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    })
  })
}

function onGridScroll() {
  const grid = gridRef.value
  const first = itemRefs.value[0]
  const nextPage = itemRefs.value[PAGE]
  if (!grid || !first) return
  const start = pageStartAtScroll({
    scrollTop: grid.scrollTop,
    pageHeightPx: nextPage ? nextPage.offsetTop - first.offsetTop : 0,
    isAtBottom: grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 1,
    count: props.items.length,
    pageSize: PAGE,
  })
  if (start === pageStart.value) return
  pageStart.value = start
  if (!hasShortcut(selectedIndex.value, start, PAGE))
    selectedIndex.value = start
}

function focusSearch() {
  inputRef.value?.focus()
}

function focusGrid() {
  if (!gridRef.value) {
    focusSearch()
    return
  }
  inputRef.value?.blur()
  gridRef.value.focus()
}

function clearQuery() {
  query.value = ''
  void nextTick(focusSearch)
}

function onEscape(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  emit('escape', event.shiftKey)
}

function isPlainKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey
}

function isFindKey(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 'f'
  )
}

/** The shortcut slot of the key pressed, by its physical position first */
function slotOf(event: KeyboardEvent): number {
  const codeLetter =
    event.code.length === 4 && event.code.startsWith('Key')
      ? event.code.slice(3).toLowerCase()
      : undefined
  const letter = (codeLetter || event.key.toLowerCase()) as ShortcutSlotKey
  return SHORTCUT_SLOT_KEYS.indexOf(letter)
}

function pickBySlot(event: KeyboardEvent): boolean {
  const target = shortcutTarget(
    slotOf(event),
    pageStart.value,
    props.items.length
  )
  if (target === undefined) return false
  event.preventDefault()
  select(target)
  return true
}

function onSearchKeyDown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    if (event.shiftKey) {
      onEscape(event)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (query.value) query.value = ''
    else if (props.items.length > 0) focusGrid()
    else emit('escape', false)
    return
  }
  if (isFindKey(event)) {
    event.preventDefault()
    inputRef.value?.select()
    return
  }
  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !props.shortcutsDisabled &&
    pickBySlot(event)
  )
    return
  if (event.key === 'ArrowDown' || event.key === 'Tab') {
    event.preventDefault()
    focusGrid()
    moveTo(pageStart.value)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    select(selectedIndex.value)
  }
}

function onGridKeyDown(event: KeyboardEvent) {
  if (event.isComposing || props.shortcutsDisabled) return
  if (event.key === 'Escape') {
    onEscape(event)
    return
  }
  if (isFindKey(event) || event.key === '/') {
    event.preventDefault()
    focusSearch()
    return
  }

  const count = props.items.length
  if (count === 0) return
  const index = selectedIndex.value

  const moves: Record<string, () => number | 'search' | undefined> = {
    ArrowRight: () => (index + 1 < count ? index + 1 : undefined),
    ArrowLeft: () => (index > 0 ? index - 1 : undefined),
    ArrowDown: () =>
      index + COLUMNS < count
        ? index + COLUMNS
        : index < count - 1
          ? count - 1
          : undefined,
    ArrowUp: () => (index >= COLUMNS ? index - COLUMNS : 'search'),
    PageDown: () => Math.min(count - 1, pageStart.value + PAGE),
    PageUp: () => Math.max(0, pageStart.value - PAGE),
    Home: () => 0,
    End: () => count - 1,
  }
  const move = moves[event.key]
  if (move) {
    event.preventDefault()
    const target = move()
    if (target === 'search') focusSearch()
    else if (target !== undefined) moveTo(target)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    select(index)
    return
  }

  if (isPlainKey(event) && pickBySlot(event)) return

  if (event.key === 'Backspace') {
    event.preventDefault()
    focusSearch()
    query.value = query.value.slice(0, -1)
    return
  }
  if (event.key.length === 1 && isPlainKey(event)) {
    event.preventDefault()
    focusSearch()
    query.value += event.key
  }
}

/** Ctrl+F reaches the search from anywhere in the window */
function onWindowKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || !isFindKey(event)) return
  event.preventDefault()
  focusSearch()
  inputRef.value?.select()
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown)
  void nextTick(focusGrid)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeyDown)
})

defineExpose({ focusSearch })
</script>

<style scoped>
.search-grid {
  --search-grid-page-height: calc(3 * 4.25rem + 2 * var(--space-sm) + 4px);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  min-height: 0;
  flex: 1 1 0%;
}

.search-grid.is-dense {
  gap: var(--space-xs);
}

.search-grid-search-row {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 100%;
}

.search-grid-search-icon {
  position: absolute;
  left: 0.75rem;
  color: var(--app-text-muted);
  pointer-events: none;
}

.search-grid-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 2.25rem;
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  color: var(--color-base-content);
  font-size: var(--text-control);
  outline: none;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.is-dense .search-grid-search-input {
  padding-top: 0.3rem;
  padding-bottom: 0.3rem;
}

.search-grid-search-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.search-grid-search-extra {
  position: absolute;
  right: 0.75rem;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.search-grid-page {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.search-grid-search-hint {
  --key-font-size: var(--text-caption);
  pointer-events: none;
  opacity: 0.7;
}

.search-grid-search-clear {
  background: none;
  border: none;
  color: var(--app-text-muted);
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

.search-grid-search-clear:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.search-grid-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-auto-rows: 4.25rem;
  gap: var(--space-sm);
  align-content: start;
  min-height: 0;
  /* A fixed page of 3 rows, so the layout does not depend on the count */
  flex: 0 0 auto;
  height: var(--search-grid-page-height);
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  scroll-padding: 2px;
  overscroll-behavior: contain;
  padding: 2px;
  outline: none;
}

.is-dense .search-grid-grid {
  grid-auto-rows: 2.5rem;
  gap: var(--space-xs);
  height: auto;
  max-height: calc(4 * 2.5rem + 3 * var(--space-xs) + 4px);
}

.is-tall .search-grid-grid {
  grid-auto-rows: 8.5rem;
  flex: 1 1 0%;
  height: auto;
}

.search-grid-cell.is-page-start {
  scroll-snap-align: start;
}

.search-grid-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
  overflow: hidden;
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.is-dense .search-grid-cell {
  justify-content: center;
  padding: 0 var(--space-xs);
}

.search-grid-cell:hover {
  background-color: var(--app-hover);
  border-color: var(--app-border);
}

.search-grid-cell.is-selected {
  border-color: var(--color-primary);
  background-color: color-mix(
    in oklab,
    var(--color-primary) 10%,
    var(--app-surface-raised)
  );
  box-shadow: 0 0 0 1px var(--color-primary);
}

.search-grid-cell-top {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 1.5rem;
  min-width: 0;
  flex-shrink: 0;
}

.search-grid-slot-key {
  --key-size: 1.35rem;
  --key-font-size: var(--text-caption);
  flex-shrink: 0;
}

.search-grid-slot-index {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  flex-shrink: 0;
}

.is-dense .search-grid-empty,
.is-tall .search-grid-empty {
  height: auto;
}

.search-grid-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0%;
  min-height: 4rem;
  height: var(--search-grid-page-height);
  box-sizing: border-box;
  color: var(--app-text-muted);
  font-size: var(--text-control);
  text-align: center;
}
</style>
