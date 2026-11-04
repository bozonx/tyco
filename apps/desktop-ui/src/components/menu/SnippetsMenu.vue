<template>
  <ActionOverlayLayout :title="t('menu.snippets')" :on-esc="close">
    <template #actions>
      <div class="snippets-menu">
        <div class="snippets-search-row">
          <AppIcon icon="mdi:magnify" size="md" class="snippets-search-icon" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            class="snippets-search-input"
            :placeholder="t('settings.searchSnippetsPlaceholder')"
            :aria-label="t('settings.searchSnippetsPlaceholder')"
            spellcheck="false"
            autocomplete="off"
            @keydown="onKeyDown"
          />
        </div>

        <div
          v-if="filteredSnippets.length > 0"
          ref="listRef"
          class="snippets-list"
          role="listbox"
        >
          <div
            v-for="(snippet, index) in filteredSnippets"
            :key="snippet.id"
            :ref="(el) => setItemRef(index, el)"
            role="option"
            class="snippet-item"
            :class="{ 'is-selected': index === selectedIndex }"
            :aria-selected="index === selectedIndex"
            @click="selectSnippet(snippet)"
            @mouseenter="selectedIndex = index"
          >
            <div class="snippet-item-text">{{ snippet.text }}</div>
          </div>
        </div>
        <div v-else class="snippets-empty">
          {{
            allSnippets.length === 0
              ? t('settings.noSnippets')
              : t('snippets.noMatches')
          }}
        </div>

        <div class="snippets-hints">
          <ShortcutHint
            :keys="['Enter']"
            :label="t('action.insertIntoWindow')"
            :disabled="filteredSnippets.length === 0"
          />
          <ShortcutHint :keys="['Esc']" :label="t('common.cancel')" />
        </div>
      </div>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import { filterSnippets } from '../../lib/snippets/snippets-model'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menu-modals'
import AppIcon from '../common/AppIcon.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutHint from '../overlay/ShortcutHint.vue'
import type { SnippetConfig } from '@tyco/shared'

const { t } = useI18n()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const { handleEsc } = useOverlayNav()

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)
const itemRefs = ref<(HTMLElement | null)[]>([])

const setItemRef = (index: number, el: unknown) => {
  itemRefs.value[index] = el as HTMLElement | null
}

const allSnippets = computed<SnippetConfig[]>(() => {
  return desktopStore.userConfig.snippets?.items ?? []
})

const filteredSnippets = computed<SnippetConfig[]>(() => {
  return filterSnippets(allSnippets.value, query.value)
})

watch(filteredSnippets, () => {
  selectedIndex.value = 0
})

function close() {
  handleEsc()
}

async function selectSnippet(snippet?: SnippetConfig) {
  if (!snippet) return
  menuModalsStore.closeAll()
  await ipcStore.callOrNotify('paste_into_target_and_hide', {
    text: snippet.text,
  })
}

function scrollToSelected(index: number) {
  void nextTick(() => {
    const el = itemRefs.value[index]
    el?.scrollIntoView?.({ block: 'nearest' })
  })
}

function onKeyDown(event: KeyboardEvent) {
  if (event.isComposing) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      if (filteredSnippets.value.length > 0) {
        selectedIndex.value =
          (selectedIndex.value + 1) % filteredSnippets.value.length
        scrollToSelected(selectedIndex.value)
      }
      break
    case 'ArrowUp':
      event.preventDefault()
      if (filteredSnippets.value.length > 0) {
        selectedIndex.value =
          (selectedIndex.value - 1 + filteredSnippets.value.length) %
          filteredSnippets.value.length
        scrollToSelected(selectedIndex.value)
      }
      break
    case 'Enter':
      event.preventDefault()
      if (event.repeat) return
      void selectSnippet(filteredSnippets.value[selectedIndex.value])
      break
    case 'Escape':
      event.preventDefault()
      close()
      break
  }
}

onMounted(() => {
  void nextTick(() => {
    inputRef.value?.focus()
  })
})
</script>

<style scoped>
.snippets-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
  height: 100%;
  min-height: 0;
}

.snippets-search-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
}

.snippets-search-icon {
  color: var(--app-text-muted);
  flex-shrink: 0;
}

.snippets-search-input {
  flex: 1 1 0%;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--app-text-primary);
  font-size: var(--text-sm);
}

.snippets-search-input::placeholder {
  color: var(--app-text-muted);
}

.snippets-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  overflow-y: auto;
  flex: 1 1 0%;
  min-height: 120px;
  max-height: 320px;
  padding-right: var(--space-2xs);
}

.snippet-item {
  display: flex;
  align-items: flex-start;
  padding: var(--space-xs) var(--space-sm);
  background-color: var(--app-surface-neutral);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.snippet-item:hover {
  background-color: var(--app-surface-hover);
}

.snippet-item.is-selected {
  background-color: var(--app-surface-selected);
  border-color: var(--app-border-focus);
}

.snippet-item-text {
  font-size: var(--text-sm);
  line-height: var(--line-height-normal);
  color: var(--app-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.snippets-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0%;
  min-height: 100px;
  color: var(--app-text-muted);
  font-size: var(--text-sm);
}

.snippets-hints {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding-top: var(--space-2xs);
  border-top: 1px solid var(--app-border-subtle);
}
</style>
