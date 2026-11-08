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

    <SearchShortcutGrid
      v-model:query="query"
      tall
      :items="filteredFavorites"
      :placeholder="t('settings.searchFavoritesPlaceholder')"
      :empty-text="
        allFavorites.length === 0
          ? t('settings.noFavorites')
          : t('favorites.noMatches')
      "
      :shortcuts-disabled="props.shortcutsDisabled"
      @select="selectFavorite"
      @escape="onEscape"
    >
      <template #title="{ item }">
        <span v-if="item.name" class="favorite-name">{{ item.name }}</span>
      </template>
      <template #item="{ item }">
        <div class="favorite-cell-text">{{ item.text }}</div>
      </template>
    </SearchShortcutGrid>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import { filterFavorites } from '../../lib/favorites/favorites-model'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menu-modals'
import KeyboardKey from '../common/KeyboardKey.vue'
import SearchShortcutGrid from './SearchShortcutGrid.vue'
import type { FavoriteConfig } from '@tyco/shared'

const props = withDefaults(defineProps<{ shortcutsDisabled?: boolean }>(), {
  shortcutsDisabled: false,
})

const { t } = useI18n()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()

const query = ref('')

const { escLabel, escTitle, handleEsc, handleCloseAll } = useOverlayNav()

function onEscClick(event: MouseEvent) {
  if (event.shiftKey) handleCloseAll()
  else handleEsc()
}

function onEscape(isShifted: boolean) {
  if (isShifted) handleCloseAll()
  else handleEsc()
}

const allFavorites = computed<FavoriteConfig[]>(
  () => desktopStore.userConfig.favorites?.items ?? []
)

const filteredFavorites = computed<FavoriteConfig[]>(() =>
  filterFavorites(allFavorites.value, query.value)
)

async function selectFavorite(favorite: FavoriteConfig) {
  menuModalsStore.closeAll()
  await ipcStore.callOrNotify('paste_into_target_and_hide', {
    text: favorite.text,
  })
}

function onGlobalKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && event.shiftKey) {
    event.preventDefault()
    handleCloseAll()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeyDown)
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
.favorite-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: var(--space-xs);
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
</style>
