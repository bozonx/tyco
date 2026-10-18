<template>
  <div class="editor-toolbar flex items-center justify-between gap-2">
    <!-- Left column: view mode, Case and Format dropdowns, then plugin items -->
    <div data-testid="editor-toolbar-left" class="flex items-center gap-1">
      <IconButton
        size="sm"
        variant="ghost"
        class="view-mode-toggle"
        :tone="showMarkup ? 'accent' : 'muted'"
        :active="showMarkup"
        :aria-pressed="showMarkup"
        @click="toggleShowMarkup"
        :label="viewModeTitle"
        :icon="showMarkup ? 'mdi:language-markdown-outline' : 'mdi:format-text'"
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
      <Button
        v-for="item in leftToolbarItems"
        :key="item.id"
        size="sm"
        :square="isToolbarItemSquare(labelOf(item))"
        variant="ghost"
        :disabled="isToolbarItemDisabled(item, editorInputStore.hasSelection)"
        :title="scoped(tooltipOf(item))"
        @click="item.action"
      >
        <AppIcon v-if="item.icon" :icon="item.icon" size="lg" />
        <span v-if="labelOf(item)" class="text-sm font-medium leading-none">{{
          labelOf(item)
        }}</span>
      </Button>
    </div>

    <!-- Right column: plugin items, then Ask AI, AI task, Translation & Insert to window -->
    <div data-testid="editor-toolbar-right" class="flex items-center gap-1">
      <Button
        v-for="item in rightToolbarItems"
        :key="item.id"
        size="sm"
        :square="isToolbarItemSquare(labelOf(item))"
        variant="ghost"
        :disabled="isToolbarItemDisabled(item, editorInputStore.hasSelection)"
        :title="scoped(tooltipOf(item))"
        @click="item.action"
      >
        <AppIcon v-if="item.icon" :icon="item.icon" size="lg" />
        <span v-if="labelOf(item)" class="text-sm font-medium leading-none">{{
          labelOf(item)
        }}</span>
      </Button>
      <IconButton
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
        :label="scoped(t('action.aiTask'))"
        icon="mdi:robot-outline"
      />
      <IconButton
        size="sm"
        variant="ghost"
        @click="emit('translation')"
        :label="scoped(t('action.translation'))"
        icon="mdi:translate"
      />
      <IconButton
        size="sm"
        variant="ghost"
        :disabled="!desktopStore.desktopState.windowId"
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
import {
  getToolbarLabel,
  getToolbarTooltip,
  isToolbarItemDisabled,
  isToolbarItemSquare,
  scopedActionLabel,
} from '../../lib/editor/editor-toolbar-item'
import { useDesktopStore } from '../../stores/desktop'
import type { EditItem } from '../../stores/edit-menu'
import { useEditMenuStore } from '../../stores/edit-menu'
import { useEditorInputStore } from '../../stores/editor-input'
import { useToolbarStore } from '../../stores/toolbar'
import type { ToolbarItem } from '../../types/plugins'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'

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
const { showMarkup, toggleShowMarkup } = useMarkupMode()

const viewModeTitle = computed(() =>
  t(
    showMarkup.value
      ? 'editor.markup.switchToFormatted'
      : 'editor.markup.switchToSource'
  )
)

const caseDropdownItems = computed<DropdownMenuItem[]>(() =>
  editMenuStore
    .getCaseItems()
    .map((item: EditItem) => ({
      label: getLabel(item),
      icon: item.icon,
      action: () => doEdit(item),
    }))
)

const formatDropdownItems = computed<DropdownMenuItem[]>(() =>
  editMenuStore
    .getFormatItems()
    .map((item: EditItem) => ({
      label: getLabel(item),
      icon: item.icon,
      action: () => doEdit(item),
    }))
)

const leftToolbarItems = computed(() => toolbarStore.getLeftToolbarItems())
const rightToolbarItems = computed(() => toolbarStore.getRightToolbarItems())

const scoped = (label: string) =>
  scopedActionLabel(label, editorInputStore.hasSelection, t)
const tooltipOf = (item: ToolbarItem) => getToolbarTooltip(item, t)
const labelOf = (item: ToolbarItem) => getToolbarLabel(item, t)
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
