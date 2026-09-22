<template>
  <div class="editor-root" :class="{ 'is-compact': compact }">
    <div class="editor-frame">
      <!-- Toolbar above editor -->
      <div
        v-show="!compact"
        class="editor-toolbar flex items-center justify-between gap-2"
      >
        <!-- Left column: Case and Format dropdowns, then plugin items -->
        <div class="flex items-center gap-1">
          <DropdownMenu :label="t('editor.case')" :items="caseDropdownItems" />
          <DropdownMenu
            :label="t('editor.format')"
            :items="formatDropdownItems"
          />
          <Button
            v-for="item in leftToolbarItems"
            :key="item.id"
            sm
            square
            ghost
            :title="getToolbarTooltip(item)"
            @click="item.action"
          >
            <Icon :icon="item.icon" height="18" />
          </Button>
        </div>

        <!-- Right column: plugin items, then AI task, Translation & Insert to window -->
        <div class="flex items-center gap-1">
          <Button
            v-for="item in rightToolbarItems"
            :key="item.id"
            sm
            square
            ghost
            :title="getToolbarTooltip(item)"
            @click="item.action"
          >
            <Icon :icon="item.icon" height="18" />
          </Button>
          <Button
            sm
            square
            ghost
            @click="handleAiTask"
            :title="t('action.aiTask')"
          >
            <Icon icon="mdi:robot-outline" height="18" />
          </Button>
          <Button
            sm
            square
            ghost
            @click="handleTranslation"
            :title="t('action.translation')"
          >
            <Icon icon="mdi:translate" height="18" />
          </Button>
          <Button
            sm
            square
            ghost
            @click="handleInsertToWindow"
            :title="t('action.insertIntoWindow')"
          >
            <Icon icon="mdi:application-export" height="18" />
          </Button>
        </div>
      </div>

      <!-- Main editor area -->
      <div class="editor-body">
        <div class="flex-1 min-w-0">
          <EditorInput />
        </div>
        <div class="editor-rail">
          <template v-if="compact">
            <Button
              sm
              square
              ghost
              class="rail-danger"
              @click="editorInputStore.clear"
              :title="t('editor.clear')"
            >
              <Icon icon="mdi:eraser" height="18" />
            </Button>
          </template>
          <template v-else>
            <Button
              sm
              square
              ghost
              class="rail-accent"
              @click="voiceRecognition"
              :title="t('editor.voiceInput')"
            >
              <Icon icon="mdi:microphone-outline" height="20" />
            </Button>
            <Button
              sm
              square
              ghost
              class="rail-accent"
              @click="handleCorrection"
              :title="t('action.correction')"
            >
              <Icon icon="mdi:auto-fix" height="20" />
            </Button>
            <div class="rail-divider" />
            <Button
              sm
              square
              ghost
              @click="handleCopy"
              :title="t('action.copyToClipboard')"
            >
              <Icon icon="mdi:content-copy" height="18" />
            </Button>
            <Button
              sm
              square
              ghost
              @click="editorInputStore.selectAll"
              :title="t('editor.selectAll')"
            >
              <Icon icon="mdi:select-all" height="18" />
            </Button>
            <Button
              sm
              square
              ghost
              class="rail-danger"
              @click="editorInputStore.clear"
              :title="t('editor.clear')"
            >
              <Icon icon="mdi:eraser" height="18" />
            </Button>
          </template>
        </div>
      </div>
    </div>

    <div class="editor-footer">
      <p v-show="!compact" class="editor-hint">
        <Icon icon="mdi:information-outline" height="14" class="shrink-0" />
        {{ t('editor.selectionHint') }}
      </p>

      <div
        v-if="!compact && otherEditItems.length > 0"
        class="flex gap-1.5 w-full flex-wrap"
      >
        <Button
          v-for="item in otherEditItems"
          :key="item.labelKey || item.name"
          sm
          neutral
          :icon="item.icon"
          @click="doEdit(item.action)"
          >{{ getLabel(item) }}</Button
        >
      </div>

      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useEditorActions } from '../composables/useEditorActions'
import { useI18n } from '../composables/useI18n'
import type { ActionItem } from '../stores/actionMenu'
import { useActionMenuStore } from '../stores/actionMenu'
import type { EditItem } from '../stores/editMenu'
import { useEditMenuStore } from '../stores/editMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useToolbarStore } from '../stores/toolbar'
import type { ToolbarItem } from '../types/plugins'
import DropdownMenu, { type DropdownMenuItem } from './common/DropdownMenu.vue'
import { Icon } from '@iconify/vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const actionMenuStore = useActionMenuStore()
const editorInputStore = useEditorInputStore()
const editMenuStore = useEditMenuStore()
const toolbarStore = useToolbarStore()
const { t } = useI18n()
const { getLabel, voiceRecognition, doAction, doEdit } = useEditorActions()

const caseDropdownItems = computed<DropdownMenuItem[]>(() =>
  editMenuStore
    .getCaseItems()
    .map((item: EditItem) => ({
      label: getLabel(item),
      icon: item.icon,
      action: () => doEdit(item.action),
    }))
)

const formatDropdownItems = computed<DropdownMenuItem[]>(() =>
  editMenuStore
    .getFormatItems()
    .map((item: EditItem) => ({
      label: getLabel(item),
      icon: item.icon,
      action: () => doEdit(item.action),
    }))
)

const otherEditItems = computed(() => editMenuStore.getOtherEditItems())

const leftToolbarItems = computed(() => toolbarStore.getLeftToolbarItems())
const rightToolbarItems = computed(() => toolbarStore.getRightToolbarItems())

const getToolbarTooltip = (item: ToolbarItem): string => {
  if (item.tooltipKey) {
    return t(item.tooltipKey)
  }
  return item.tooltip || ''
}

const handleAiTask = async () => {
  const aiTaskAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.aiTask')
  if (aiTaskAction) {
    await doAction(aiTaskAction)
  }
}

const handleInsertToWindow = async () => {
  const insertAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.insertIntoWindow')
  if (insertAction) {
    await doAction(insertAction)
  }
}

const handleTranslation = async () => {
  const translationAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.translation')
  if (translationAction) {
    await doAction(translationAction)
  }
}

const handleCorrection = async () => {
  const correctionAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.correction')
  if (correctionAction) {
    await doAction(correctionAction)
  }
}

const handleCopy = async () => {
  const copyAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.copyToClipboard')
  if (copyAction) {
    await doAction(copyAction)
  }
}
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  height: 100%;
  min-height: 0;
}

.editor-root.is-compact {
  height: auto;
  gap: var(--space-xs);
}

.is-compact .editor-frame {
  flex: 0 1 auto;
}

.is-compact .editor-body {
  flex: 0 1 auto;
  align-items: flex-end;
}

.is-compact .editor-footer {
  gap: 0;
}

.editor-frame {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  overflow: hidden;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.editor-frame:focus-within {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  box-shadow:
    var(--app-shadow-sm),
    0 0 0 3px color-mix(in oklab, var(--color-primary) 12%, transparent);
}

.editor-toolbar {
  padding: 0.3125rem 0.375rem;
  border-bottom: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}

.editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.editor-body :deep(.main-input) {
  border: none;
  border-radius: 0;
  box-shadow: none;
  background-color: transparent;
}

.editor-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0.375rem;
  border-left: 1px solid var(--app-border-subtle);
}

.rail-divider {
  width: 1.25rem;
  height: 1px;
  margin: 0.25rem 0;
  background-color: var(--app-border);
}

.editor-root :deep(.btn-ghost) {
  color: var(--app-text-muted);
}

.editor-root :deep(.btn-ghost:hover) {
  color: var(--color-base-content);
}

.editor-root :deep(.btn-ghost.rail-accent) {
  color: var(--color-primary);
}

.editor-root :deep(.btn-ghost.rail-accent:hover) {
  --btn-bg: var(--app-accent-soft);
}

.editor-root :deep(.btn-ghost.rail-danger:hover) {
  color: var(--color-error);
}

.editor-footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  flex-shrink: 0;
}

.editor-hint {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0;
  font-size: 0.75rem;
  color: var(--app-text-faint);
}
</style>
