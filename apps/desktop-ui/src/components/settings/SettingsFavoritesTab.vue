<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.favoritesTab')"
      :info="t('settings.favoritesHint')"
      bare
    >
      <template #actions>
        <Button
          variant="primary"
          size="sm"
          icon="mdi:plus"
          @click="addNewFavorite"
        >
          {{ t('settings.addFavorite') }}
        </Button>
      </template>

      <div class="favorites-tab">
        <StateMessage
          v-if="!favorites.length"
          class="favorites-empty"
          :message="t('settings.noFavorites')"
        />

        <div v-else ref="listRef" class="favorites-list">
          <div
            v-for="(favorite, index) in favorites"
            :key="favorite.id"
            data-sortable-item
            class="favorite-card"
            :class="{
              'is-sorting': isSorting,
              'is-dragged': draggedIndex === index,
              'is-empty': !favorite.text?.trim(),
            }"
            :style="itemStyle(index)"
          >
            <div class="favorite-card-drag">
              <DragHandle @drag="startDrag(index, $event)" />
            </div>
            <div class="favorite-card-key">
              <KeyboardKey v-if="index < 15" class="favorite-slot-key">
                {{ SHORTCUT_SLOT_KEYS[index]?.toUpperCase() }}
              </KeyboardKey>
              <span v-else class="favorite-slot-index">#{{ index + 1 }}</span>
            </div>
            <div class="favorite-card-content">
              <FieldInput
                :model-value="favorite.name ?? ''"
                :placeholder="t('settings.favoriteNamePlaceholder')"
                :aria-label="t('settings.favoriteNamePlaceholder')"
                @update:model-value="updateFavoriteName(index, $event)"
              />
              <FieldPromptTextArea
                :model-value="favorite.text"
                :placeholder="t('settings.favoriteTextPlaceholder')"
                :aria-label="t('settings.favoriteTextPlaceholder')"
                :modal-title="t('settings.favoritesTab')"
                @update:model-value="updateFavoriteText(index, $event)"
              />
            </div>
            <div class="favorite-card-actions">
              <IconButton
                size="sm"
                variant="ghost"
                icon="mdi:trash-can-outline"
                :label="t('common.delete')"
                @click="deleteFavorite(index)"
              />
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { type CSSProperties, computed, nextTick, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useSortableList } from '../../composables/use-sortable-list'
import {
  nextFavoriteId,
  reorderFavorites,
} from '../../lib/favorites/favorites-model'
import Button from '../common/Button.vue'
import DragHandle from '../common/DragHandle.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import IconButton from '../common/IconButton.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsSection from './SettingsSection.vue'
import { type FavoriteConfig, SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()

const listRef = ref<HTMLElement | null>(null)

const favorites = computed<FavoriteConfig[]>(
  () => userConfig.value.favorites?.items ?? []
)

const { draggedIndex, isSorting, startDrag, itemOffset } = useSortableList(
  listRef,
  (from, to) => {
    const next = reorderFavorites(favorites.value, from, to)
    userConfig.value.favorites = { items: next }
  }
)

const itemStyle = (index: number): CSSProperties | undefined => {
  const offset = itemOffset(index)
  if (!offset) return undefined
  return { transform: `translate3d(0, ${offset}px, 0)` }
}

function addNewFavorite() {
  const nextId = nextFavoriteId(favorites.value)
  userConfig.value.favorites = {
    items: [...favorites.value, { id: nextId, text: '' }],
  }
  void nextTick(() => {
    const cards = listRef.value?.querySelectorAll('.favorite-card')
    const lastCard = cards?.[cards.length - 1] as HTMLElement | undefined
    if (lastCard) {
      lastCard.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
      const textarea = lastCard.querySelector('textarea')
      textarea?.focus()
    }
  })
}

function updateFavoriteText(index: number, text: string) {
  const current = [...favorites.value]
  const target = current[index]
  if (target) {
    current[index] = { ...target, text }
    userConfig.value.favorites = { items: current }
  }
}

function updateFavoriteName(index: number, name: string) {
  const current = [...favorites.value]
  const target = current[index]
  if (target) {
    current[index] = { ...target, name }
    userConfig.value.favorites = { items: current }
  }
}

function deleteFavorite(index: number) {
  const current = [...favorites.value]
  current.splice(index, 1)
  userConfig.value.favorites = { items: current }
}
</script>

<style scoped>
.favorites-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.favorites-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.favorite-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: var(--space-sm);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
  transition:
    transform var(--transition-base),
    opacity var(--transition-fast);
}

.favorite-card.is-sorting {
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-base);
}

.favorite-card.is-dragged {
  position: relative;
  z-index: 1;
  box-shadow: var(--app-shadow-lg);
  border-color: var(--color-primary);
  transition: none;
}

.favorite-card.is-empty {
  border-color: color-mix(in oklab, var(--color-primary) 70%, transparent);
  box-shadow: 0 0 0 2px
    color-mix(in oklab, var(--color-primary) 25%, transparent);
}

.favorite-card-drag {
  padding-top: var(--space-xs);
  flex-shrink: 0;
}

.favorite-card-key {
  padding-top: var(--space-xs);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 1.75rem;
}

.favorite-slot-key {
  --key-size: 1.5rem;
}

.favorite-slot-index {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  user-select: none;
}

.favorite-card-content {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.favorite-card-actions {
  flex-shrink: 0;
}

.favorites-empty {
  padding: var(--space-xl) var(--space-md);
}
</style>
