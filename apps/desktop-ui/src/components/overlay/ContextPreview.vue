<template>
  <div v-if="props.disabled" class="context-disabled-banner">
    <div class="context-disabled-info">
      <AppIcon
        icon="mdi:text-box-remove-outline"
        size="sm"
        class="context-disabled-icon"
      />
      <span class="context-disabled-text">{{ t('menu.contextRemoved') }}</span>
    </div>
    <Button
      class="context-restore-btn"
      size="xs"
      variant="ghost"
      icon="mdi:undo"
      @click="handleRestore"
    >
      {{ t('action.restoreContext') }}
    </Button>
  </div>

  <div v-else class="context-preview-area">
    <Diff
      v-if="props.oldText"
      :old-text="props.oldText"
      :new-text="props.text"
      :mode="props.diffMode"
    />
    <TextPreview v-else :text="props.text" />

    <div v-if="activeText" class="preview-actions">
      <IconButton
        v-if="props.allowFavorite"
        class="preview-action-btn"
        size="sm"
        :label="
          isSavedAsFavorite
            ? t('action.savedAsFavorite')
            : t('action.saveAsFavorite')
        "
        :icon="isSavedAsFavorite ? 'mdi:check' : 'mdi:bookmark-plus-outline'"
        @click="saveAsFavorite"
      />
      <CopyButton
        v-if="props.allowCopy"
        class="preview-action-btn"
        :value="activeText"
        :label="t('action.copy')"
        size="sm"
      />
      <IconButton
        v-if="props.allowDisable"
        class="preview-action-btn"
        size="sm"
        :label="t('action.removeContext')"
        icon="mdi:close"
        @click="handleRemove"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import type { DiffViewMode } from '../../lib/diff/diff-model'
import {
  addFavorite,
  isDuplicateFavorite,
} from '../../lib/favorites/favorites-model'
import { useDesktopStore } from '../../stores/desktop'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import CopyButton from '../common/CopyButton.vue'
import Diff from '../common/Diff.vue'
import IconButton from '../common/IconButton.vue'
import TextPreview from '../common/TextPreview.vue'

const props = withDefaults(
  defineProps<{
    text?: string
    oldText?: string
    diffMode?: DiffViewMode
    disabled?: boolean
    allowFavorite?: boolean
    allowCopy?: boolean
    allowDisable?: boolean
  }>(),
  {
    text: '',
    oldText: '',
    diffMode: 'split',
    disabled: false,
    allowFavorite: true,
    allowCopy: true,
    allowDisable: true,
  }
)

const emit = defineEmits<{
  (e: 'update:disabled', value: boolean): void
  (e: 'remove'): void
  (e: 'restore'): void
}>()

const { t } = useI18n()
const { toastKey, toastError } = useToast()
const desktopStore = useDesktopStore()

const isSavedAsFavorite = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | null = null

const activeText = computed(() => props.text)

async function saveAsFavorite() {
  const text = activeText.value.trim()
  if (!text) return

  const currentFavorites = desktopStore.userConfig.favorites?.items ?? []
  if (isDuplicateFavorite(currentFavorites, text)) {
    toastKey('toast.favoriteAlreadyExists', 'warn')
    return
  }

  const result = addFavorite(currentFavorites, text)
  if (result.success) {
    const response = await desktopStore.updateUserConfig({
      favorites: { items: result.items },
    })
    if (!response.success) {
      toastError(response.error)
      return
    }
    isSavedAsFavorite.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => {
      isSavedAsFavorite.value = false
    }, 1500)
  }
}

function handleRemove() {
  emit('update:disabled', true)
  emit('remove')
}

function handleRestore() {
  emit('update:disabled', false)
  emit('restore')
}

onUnmounted(() => {
  if (savedTimer) clearTimeout(savedTimer)
})
</script>

<style scoped>
.context-preview-area {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
}

.context-disabled-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-xs) var(--space-sm);
  background-color: var(--app-surface-raised);
  border: 1px dashed var(--app-border-subtle);
  border-radius: var(--radius-md);
  color: var(--app-text-muted);
  font-size: var(--text-caption);
}

.context-disabled-info {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.context-disabled-icon {
  flex-shrink: 0;
  color: var(--app-text-muted);
}

.context-disabled-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-restore-btn {
  flex-shrink: 0;
}

.preview-actions {
  position: absolute;
  top: var(--space-xs);
  right: var(--space-xs);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.preview-action-btn {
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  opacity: 0.85;
  transition:
    opacity var(--transition-fast),
    background-color var(--transition-fast);
}

.preview-action-btn:hover {
  opacity: 1;
}
</style>
