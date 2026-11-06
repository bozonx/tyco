<template>
  <div class="favorites-menu">
    <div class="favorites-header">
      <h1 class="favorites-title">{{ t('menu.favorites') }}</h1>
      <button
        type="button"
        class="favorites-esc"
        :title="escTitle"
        @click="onEscClick"
      >
        <KeyboardKey>Esc</KeyboardKey>
        <span>{{ escLabel }}</span>
      </button>
    </div>

    <div class="favorites-search-row">
      <AppIcon icon="mdi:magnify" size="md" class="favorites-search-icon" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        class="favorites-search-input"
        :placeholder="t('settings.searchFavoritesPlaceholder')"
        :aria-label="t('settings.searchFavoritesPlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @focus="isSearchFocused = true"
        @blur="isSearchFocused = false"
        @keydown="onSearchKeyDown"
      />
      <button
        v-if="query"
        type="button"
        class="favorites-search-clear"
        aria-label="Clear"
        @click="clearQuery"
      >
        <AppIcon icon="mdi:close" size="sm" />
      </button>
    </div>

    <div
      v-if="filteredFavorites.length > 0"
      ref="gridRef"
      class="favorites-grid"
      tabindex="-1"
      role="grid"
      @keydown="onGridKeyDown"
    >
      <div
        v-for="(favorite, index) in filteredFavorites"
        :key="favorite.id"
        :ref="(el) => setItemRef(index, el)"
        role="row"
        class="favorite-grid-cell favorite-item"
        :class="{
          'is-selected': index === selectedIndex,
          'has-shortcut': index < 15,
        }"
        :aria-selected="index === selectedIndex"
        @click="selectFavorite(favorite)"
        @mouseenter="selectedIndex = index"
      >
        <div class="favorite-cell-top">
          <KeyboardKey v-if="index < 15" class="favorite-slot-key">
            {{ SHORTCUT_SLOT_KEYS[index]?.toUpperCase() }}
          </KeyboardKey>
          <span v-else class="favorite-slot-index">#{{ index + 1 }}</span>
          <span v-if="favorite.name" class="favorite-name">{{
            favorite.name
          }}</span>
        </div>
        <div class="favorite-cell-text favorite-item-text">
          {{ favorite.text }}
        </div>
      </div>
    </div>
    <div v-else class="favorites-empty">
      {{
        allFavorites.length === 0
          ? t('settings.noFavorites')
          : t('favorites.noMatches')
      }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import { filterFavorites } from '../../lib/favorites/favorites-model'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menu-modals'
import AppIcon from '../common/AppIcon.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import {
  type FavoriteConfig,
  SHORTCUT_SLOT_KEYS,
  type ShortcutSlotKey,
} from '@tyco/shared'

const props = withDefaults(defineProps<{ shortcutsDisabled?: boolean }>(), {
  shortcutsDisabled: false,
})

const { t } = useI18n()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()

const query = ref('')
const selectedIndex = ref(0)
const isSearchFocused = ref(true)
const inputRef = ref<HTMLInputElement | null>(null)
const gridRef = ref<HTMLDivElement | null>(null)
const itemRefs = ref<(HTMLElement | null)[]>([])

const { escLabel, escTitle, handleEsc, handleCloseAll } = useOverlayNav()

function onEscClick(event: MouseEvent) {
  if (event.shiftKey) handleCloseAll()
  else handleEsc()
}

const setItemRef = (index: number, el: unknown) => {
  itemRefs.value[index] = el as HTMLElement | null
}

const allFavorites = computed<FavoriteConfig[]>(() => {
  return desktopStore.userConfig.favorites?.items ?? []
})

const filteredFavorites = computed<FavoriteConfig[]>(() => {
  return filterFavorites(allFavorites.value, query.value)
})

watch(filteredFavorites, () => {
  selectedIndex.value = 0
})

async function selectFavorite(favorite?: FavoriteConfig) {
  if (!favorite) return
  menuModalsStore.closeAll()
  await ipcStore.callOrNotify('paste_into_target_and_hide', {
    text: favorite.text,
  })
}

function scrollToSelected(index: number) {
  void nextTick(() => {
    const el = itemRefs.value[index]
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  })
}

function clearQuery() {
  query.value = ''
  void nextTick(() => {
    inputRef.value?.focus()
  })
}

function onSearchKeyDown(event: KeyboardEvent) {
  if (event.isComposing) return

  if (event.key === 'Escape') {
    event.preventDefault()
    if (event.shiftKey) handleCloseAll()
    else handleEsc()
    event.stopPropagation()
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    inputRef.value?.blur()
    isSearchFocused.value = false
    gridRef.value?.focus()
    selectedIndex.value = 0
    scrollToSelected(0)
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    inputRef.value?.blur()
    isSearchFocused.value = false
    gridRef.value?.focus()
    selectedIndex.value = 0
    scrollToSelected(0)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    if (filteredFavorites.value.length > 0) {
      void selectFavorite(filteredFavorites.value[selectedIndex.value])
    }
  }
}

function onGridKeyDown(event: KeyboardEvent) {
  if (event.isComposing || props.shortcutsDisabled) return

  if (event.key === 'Escape') {
    event.preventDefault()
    if (event.shiftKey) handleCloseAll()
    else handleEsc()
    event.stopPropagation()
    return
  }

  const count = filteredFavorites.value.length
  if (count === 0) return

  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      if (selectedIndex.value + 1 < count) {
        selectedIndex.value += 1
        scrollToSelected(selectedIndex.value)
      }
      return
    case 'ArrowLeft':
      event.preventDefault()
      if (selectedIndex.value > 0) {
        selectedIndex.value -= 1
        scrollToSelected(selectedIndex.value)
      }
      return
    case 'ArrowDown':
      event.preventDefault()
      if (selectedIndex.value + 5 < count) {
        selectedIndex.value += 5
        scrollToSelected(selectedIndex.value)
      } else if (selectedIndex.value < count - 1) {
        selectedIndex.value = count - 1
        scrollToSelected(selectedIndex.value)
      }
      return
    case 'ArrowUp':
      event.preventDefault()
      if (selectedIndex.value >= 5) {
        selectedIndex.value -= 5
        scrollToSelected(selectedIndex.value)
      } else {
        isSearchFocused.value = true
        inputRef.value?.focus()
      }
      return
    case 'PageDown':
      event.preventDefault()
      selectedIndex.value = Math.min(count - 1, selectedIndex.value + 15)
      scrollToSelected(selectedIndex.value)
      return
    case 'PageUp':
      event.preventDefault()
      selectedIndex.value = Math.max(0, selectedIndex.value - 15)
      scrollToSelected(selectedIndex.value)
      return
    case 'Home':
      event.preventDefault()
      selectedIndex.value = 0
      scrollToSelected(0)
      return
    case 'End':
      event.preventDefault()
      selectedIndex.value = count - 1
      scrollToSelected(selectedIndex.value)
      return
    case 'Enter':
      event.preventDefault()
      void selectFavorite(filteredFavorites.value[selectedIndex.value])
      return
  }

  let codeLetter: string | undefined
  if (event.code.length === 4 && event.code.startsWith('Key')) {
    codeLetter = event.code.slice(3).toLowerCase()
  }
  const letter = (codeLetter || event.key.toLowerCase()) as ShortcutSlotKey
  const shortcutIndex = SHORTCUT_SLOT_KEYS.indexOf(letter)
  if (shortcutIndex >= 0 && shortcutIndex < count) {
    event.preventDefault()
    void selectFavorite(filteredFavorites.value[shortcutIndex])
    return
  }

  if (event.key === 'Backspace') {
    event.preventDefault()
    isSearchFocused.value = true
    inputRef.value?.focus()
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
    isSearchFocused.value = true
    inputRef.value?.focus()
    query.value += event.key
  }
}

function onGlobalKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && event.shiftKey) {
    event.preventDefault()
    handleCloseAll()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeyDown)
  void nextTick(() => {
    inputRef.value?.focus()
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeyDown)
})
</script>

<style scoped>
.favorites-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}

.favorites-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-shrink: 0;
  min-height: 1.75rem;
}

.favorites-title {
  margin: 0;
  font-size: var(--text-lead);
  font-weight: 600;
  color: var(--color-base-content);
  line-height: 1.25;
}

.favorites-esc {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0.25rem 0.5rem 0.25rem 0.25rem;
  border-radius: var(--radius-md);
  font-size: var(--text-control);
  color: var(--app-text-muted);
  cursor: pointer;
  background: transparent;
  border: none;
  flex-shrink: 0;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.favorites-esc:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.favorites-esc:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 2px;
}

.favorites-search-row {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 100%;
}

.favorites-search-icon {
  position: absolute;
  left: 0.75rem;
  color: var(--app-text-muted);
  pointer-events: none;
}

.favorites-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 2.25rem 0.5rem 2.25rem;
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

.favorites-search-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.favorites-search-clear {
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

.favorites-search-clear:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.favorites-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-auto-rows: 8.5rem;
  gap: var(--space-sm);
  align-content: start;
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  padding: 2px;
  outline: none;
}

.favorite-grid-cell {
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

.favorite-grid-cell:hover {
  background-color: var(--app-hover);
  border-color: var(--app-border);
}

.favorite-grid-cell.is-selected {
  border-color: var(--color-primary);
  background-color: color-mix(
    in oklab,
    var(--color-primary) 10%,
    var(--app-surface-raised)
  );
  box-shadow: 0 0 0 1px var(--color-primary);
}

.favorite-cell-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 1.5rem;
  flex-shrink: 0;
}

.favorite-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: var(--space-xs);
}

.favorite-slot-key {
  --key-size: 1.35rem;
  --key-font-size: var(--text-caption);
}

.favorite-slot-index {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  user-select: none;
}

.favorite-cell-text {
  font-size: var(--text-control);
  line-height: 1.35;
  color: var(--color-base-content);
  word-break: break-word;
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 0%;
}

.favorites-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0%;
  min-height: 120px;
  color: var(--app-text-muted);
  font-size: var(--text-control);
}
</style>
