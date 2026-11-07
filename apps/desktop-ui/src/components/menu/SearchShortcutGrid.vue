<template>
  <div class="search-grid" :class="{ 'is-dense': props.dense }">
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
        @keydown="onSearchKeyDown"
      />
      <button
        v-if="query"
        type="button"
        class="search-grid-search-clear"
        :aria-label="t('editor.clear')"
        @click="clearQuery"
      >
        <AppIcon icon="mdi:close" size="sm" />
      </button>
    </div>

    <div
      v-if="props.items.length > 0"
      ref="gridRef"
      class="search-grid-grid"
      tabindex="-1"
      role="grid"
      @keydown="onGridKeyDown"
    >
      <div
        v-for="(item, index) in props.items"
        :key="item.id"
        :ref="(el) => setItemRef(index, el)"
        role="row"
        class="search-grid-cell"
        :class="{ 'is-selected': index === selectedIndex }"
        :aria-selected="index === selectedIndex"
        @click="emit('select', item)"
        @mouseenter="selectedIndex = index"
      >
        <div class="search-grid-cell-top">
          <KeyboardKey
            v-if="index < SHORTCUT_SLOT_KEYS.length"
            class="search-grid-slot-key"
          >
            {{ SHORTCUT_SLOT_KEYS[index]?.toUpperCase() }}
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
import { nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import AppIcon from '../common/AppIcon.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import { SHORTCUT_SLOT_KEYS, type ShortcutSlotKey } from '@tyco/shared'

/**
 * A searched grid of items: the search field has the focus and takes the
 * typing; in the grid, reached with ArrowDown or Tab, the shortcut keys pick
 * the first items, the arrows move, and other letters go back to the search
 */
const props = withDefaults(
  defineProps<{
    items: readonly T[]
    placeholder: string
    emptyText: string
    shortcutsDisabled?: boolean
    /** Smaller cells, e.g. in a popover */
    dense?: boolean
  }>(),
  { shortcutsDisabled: false, dense: false }
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
const inputRef = ref<HTMLInputElement | null>(null)
const gridRef = ref<HTMLDivElement | null>(null)
const itemRefs = ref<(HTMLElement | null)[]>([])

const setItemRef = (index: number, el: unknown) => {
  itemRefs.value[index] = el as HTMLElement | null
}

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
  }
)

function select(index: number) {
  const item = props.items[index]
  if (item) emit('select', item)
}

function moveTo(index: number) {
  selectedIndex.value = index
  void nextTick(() => {
    itemRefs.value[index]?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    })
  })
}

function focusSearch() {
  inputRef.value?.focus()
}

function focusGrid() {
  inputRef.value?.blur()
  gridRef.value?.focus()
  moveTo(0)
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

function onSearchKeyDown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    onEscape(event)
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'Tab') {
    event.preventDefault()
    focusGrid()
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
    PageDown: () => Math.min(count - 1, index + PAGE),
    PageUp: () => Math.max(0, index - PAGE),
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

  const codeLetter =
    event.code.length === 4 && event.code.startsWith('Key')
      ? event.code.slice(3).toLowerCase()
      : undefined
  const letter = (codeLetter || event.key.toLowerCase()) as ShortcutSlotKey
  const shortcutIndex = SHORTCUT_SLOT_KEYS.indexOf(letter)
  if (
    shortcutIndex >= 0 &&
    shortcutIndex < count &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    event.preventDefault()
    select(shortcutIndex)
    return
  }

  if (event.key === 'Backspace') {
    event.preventDefault()
    focusSearch()
    query.value = query.value.slice(0, -1)
    return
  }
  if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    event.preventDefault()
    focusSearch()
    query.value += event.key
  }
}

onMounted(() => {
  void nextTick(focusSearch)
})

defineExpose({ focusSearch })
</script>

<style scoped>
.search-grid {
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

.search-grid-search-clear {
  position: absolute;
  right: 0.75rem;
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
  flex: 1 1 0%;
  min-height: 0;
  max-height: calc(3 * 4.25rem + 2 * var(--space-sm) + 4px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px;
  outline: none;
}

.is-dense .search-grid-grid {
  grid-auto-rows: 2.5rem;
  gap: var(--space-xs);
  max-height: calc(4 * 2.5rem + 3 * var(--space-xs) + 4px);
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

.search-grid-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0%;
  min-height: 4rem;
  color: var(--app-text-muted);
  font-size: var(--text-control);
  text-align: center;
}
</style>
