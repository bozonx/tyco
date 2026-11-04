<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.snippetsTab')"
      :info="t('settings.snippetsHint')"
      bare
    >
      <template #actions>
        <Button
          variant="primary"
          size="sm"
          icon="mdi:plus"
          @click="addNewSnippet"
        >
          {{ t('settings.addSnippet') }}
        </Button>
      </template>

      <div class="snippets-tab">
        <StateMessage
          v-if="!snippets.length"
          class="snippets-empty"
          :message="t('settings.noSnippets')"
        />

        <div v-else ref="listRef" class="snippets-list">
          <div
            v-for="(snippet, index) in snippets"
            :key="snippet.id"
            data-sortable-item
            class="snippet-card"
            :class="{
              'is-sorting': isSorting,
              'is-dragged': draggedIndex === index,
              'is-empty': !snippet.text?.trim(),
            }"
            :style="itemStyle(index)"
          >
            <div class="snippet-card-drag">
              <DragHandle @drag="startDrag(index, $event)" />
            </div>
            <div class="snippet-card-key">
              <KeyboardKey v-if="index < 15" class="snippet-slot-key">
                {{ SHORTCUT_SLOT_KEYS[index]?.toUpperCase() }}
              </KeyboardKey>
              <span v-else class="snippet-slot-index">#{{ index + 1 }}</span>
            </div>
            <div class="snippet-card-content">
              <FieldPromptTextArea
                :model-value="snippet.text"
                :placeholder="t('settings.snippetTextPlaceholder')"
                :aria-label="t('settings.snippetTextPlaceholder')"
                :modal-title="t('settings.snippetsTab')"
                @update:model-value="updateSnippetText(index, $event)"
              />
            </div>
            <div class="snippet-card-actions">
              <IconButton
                size="sm"
                variant="ghost"
                icon="mdi:trash-can-outline"
                :label="t('common.delete')"
                @click="deleteSnippet(index)"
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
  nextSnippetId,
  reorderSnippets,
} from '../../lib/snippets/snippets-model'
import Button from '../common/Button.vue'
import DragHandle from '../common/DragHandle.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import IconButton from '../common/IconButton.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsSection from './SettingsSection.vue'
import { SHORTCUT_SLOT_KEYS, type SnippetConfig } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()

const listRef = ref<HTMLElement | null>(null)

const snippets = computed<SnippetConfig[]>(
  () => userConfig.value.snippets?.items ?? []
)

const { draggedIndex, isSorting, startDrag, itemOffset } = useSortableList(
  listRef,
  (from, to) => {
    const next = reorderSnippets(snippets.value, from, to)
    userConfig.value.snippets = { items: next }
  }
)

const itemStyle = (index: number): CSSProperties | undefined => {
  const offset = itemOffset(index)
  if (!offset) return undefined
  return { transform: `translate3d(0, ${offset}px, 0)` }
}

function addNewSnippet() {
  const nextId = nextSnippetId(snippets.value)
  userConfig.value.snippets = {
    items: [...snippets.value, { id: nextId, text: '' }],
  }
  void nextTick(() => {
    const cards = listRef.value?.querySelectorAll('.snippet-card')
    const lastCard = cards?.[cards.length - 1] as HTMLElement | undefined
    if (lastCard) {
      lastCard.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
      const textarea = lastCard.querySelector('textarea')
      textarea?.focus()
    }
  })
}

function updateSnippetText(index: number, text: string) {
  const current = [...snippets.value]
  const target = current[index]
  if (target) {
    current[index] = { ...target, text }
    userConfig.value.snippets = { items: current }
  }
}

function deleteSnippet(index: number) {
  const current = [...snippets.value]
  current.splice(index, 1)
  userConfig.value.snippets = { items: current }
}
</script>

<style scoped>
.snippets-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.snippets-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.snippet-card {
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

.snippet-card.is-sorting {
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-base);
}

.snippet-card.is-dragged {
  position: relative;
  z-index: 1;
  box-shadow: var(--app-shadow-lg);
  border-color: var(--color-primary);
  transition: none;
}

.snippet-card.is-empty {
  border-color: color-mix(in oklab, var(--color-primary) 70%, transparent);
  box-shadow: 0 0 0 2px
    color-mix(in oklab, var(--color-primary) 25%, transparent);
}

.snippet-card-drag {
  padding-top: var(--space-xs);
  flex-shrink: 0;
}

.snippet-card-key {
  padding-top: var(--space-xs);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 1.75rem;
}

.snippet-slot-key {
  --key-size: 1.5rem;
}

.snippet-slot-index {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  user-select: none;
}

.snippet-card-content {
  flex: 1 1 0%;
  min-width: 0;
}

.snippet-card-actions {
  flex-shrink: 0;
}

.snippets-empty {
  padding: var(--space-xl) var(--space-md);
}
</style>
