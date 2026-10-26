<template>
  <div class="editor-toolbar flex items-center justify-between gap-2">
    <!-- Left column: view mode, Case and Format dropdowns, then plugin items -->
    <div data-testid="editor-toolbar-left" class="flex items-center gap-1">
      <IconButton
        size="sm"
        variant="ghost"
        class="view-mode-toggle"
        :tone="isMarkupShown ? 'accent' : 'muted'"
        :active="isMarkupShown"
        :aria-pressed="isMarkupShown"
        @click="toggleShowMarkup"
        :label="viewModeTitle"
        :icon="
          isMarkupShown ? 'mdi:language-markdown-outline' : 'mdi:format-text'
        "
      />
      <IconButton
        size="sm"
        variant="ghost"
        :label="t('editor.search.title')"
        icon="mdi:magnify"
        @click="editorInputStore.requestSearch"
      />
      <DropdownMenu :label="t('editor.case')" :items="caseDropdownItems" />
      <DropdownMenu :label="t('editor.format')" :items="formatDropdownItems" />
      <EditorToolbarItems :items="leftToolbarItems" />
    </div>

    <!-- Right column: plugin items, then Ask AI, AI task, Translation & Insert to window -->
    <div data-testid="editor-toolbar-right" class="flex items-center gap-1">
      <EditorToolbarItems :items="rightToolbarItems" />
      <IconButton
        v-if="desktopStore.userConfig.isInDevelopment"
        size="sm"
        variant="ghost"
        class="ask-ai"
        :disabled="!editorInputStore.value.trim()"
        @click="emit('ask-ai')"
        :label="scoped(t('editor.askAi'))"
        icon="mdi:chat-question-outline"
      />
      <IconButton
        size="sm"
        variant="ghost"
        @click="emit('ai-task')"
        :label="scoped(t('action.aiTaskMenu'))"
        icon="mdi:robot-outline"
      />
      <IconButton
        size="sm"
        variant="ghost"
        @click="emit('translation')"
        :label="scoped(t('action.translationMenu'))"
        icon="mdi:translate"
      />
      <IconButton
        size="sm"
        variant="ghost"
        :disabled="!desktopStore.canInsertIntoWindow"
        @click="emit('insert-to-window')"
        :label="scoped(t('action.insertIntoWindow'))"
        icon="mdi:application-export"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useEditorActions } from '../../composables/use-editor-actions'
import { useI18n } from '../../composables/use-i18n'
import { useMarkupMode } from '../../composables/use-markup-mode'
import { scopedActionLabel } from '../../lib/editor/editor-toolbar-item'
import { useDesktopStore } from '../../stores/desktop'
import type { EditItem } from '../../stores/edit-menu'
import { useEditMenuStore } from '../../stores/edit-menu'
import { useEditorInputStore } from '../../stores/editor-input'
import { useToolbarStore } from '../../stores/toolbar'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'
import EditorToolbarItems from './EditorToolbarItems.vue'

const emit = defineEmits<{
  'ask-ai': []
  'ai-task': []
  translation: []
  'insert-to-window': []
}>()

const editorInputStore = useEditorInputStore()
const editMenuStore = useEditMenuStore()
const toolbarStore = useToolbarStore()
const desktopStore = useDesktopStore()
const { t } = useI18n()
const { getLabel, doEdit } = useEditorActions()
const { isMarkupShown, toggleShowMarkup } = useMarkupMode()

const viewModeTitle = computed(() =>
  t(
    isMarkupShown.value
      ? 'editor.markup.switchToFormatted'
      : 'editor.markup.switchToSource'
  )
)

const toDropdownItem = (item: EditItem): DropdownMenuItem => ({
  label: getLabel(item),
  icon: item.icon,
  action: () => doEdit(item),
})
const caseDropdownItems = computed(() =>
  editMenuStore.getCaseItems().map(toDropdownItem)
)
const formatDropdownItems = computed(() =>
  editMenuStore.getFormatItems().map(toDropdownItem)
)

const leftToolbarItems = computed(() => toolbarStore.getLeftToolbarItems())
const rightToolbarItems = computed(() => toolbarStore.getRightToolbarItems())

const scoped = (label: string) =>
  scopedActionLabel(label, editorInputStore.hasSelection, t)
</script>

<style scoped>
.editor-toolbar {
  padding: 0.3125rem 0.375rem;
  border-bottom: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}

.editor-toolbar > div:first-child {
  min-width: 0;
  flex-wrap: wrap;
}
</style>
