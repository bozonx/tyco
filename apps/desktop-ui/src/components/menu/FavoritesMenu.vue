<template>
  <ActionOverlayLayout :title="t('menu.favorites')" other-actions-text="">
    <template #preview>
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
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import { filterFavorites } from '../../lib/favorites/favorites-model'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menu-modals'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
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

const { handleEsc, handleCloseAll } = useOverlayNav()

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
