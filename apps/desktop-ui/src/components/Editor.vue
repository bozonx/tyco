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
            :square="!getToolbarLabel(item) || getToolbarLabel(item).length <= 2"
            ghost
            :disabled="
              item.disabled ||
              (item.selectionOnly && !editorInputStore.hasSelection)
            "
            :title="scoped(getToolbarTooltip(item))"
            @click="item.action"
          >
            <Icon v-if="item.icon" :icon="item.icon" height="18" />
            <span
              v-if="getToolbarLabel(item)"
              class="text-sm font-medium leading-none"
              >{{ getToolbarLabel(item) }}</span
            >
          </Button>
        </div>

        <!-- Right column: plugin items, then AI task, Translation & Insert to window -->
        <div class="flex items-center gap-1">
          <Button
            v-for="item in rightToolbarItems"
            :key="item.id"
            sm
            :square="!getToolbarLabel(item) || getToolbarLabel(item).length <= 2"
            ghost
            :disabled="
              item.disabled ||
              (item.selectionOnly && !editorInputStore.hasSelection)
            "
            :title="scoped(getToolbarTooltip(item))"
            @click="item.action"
          >
            <Icon v-if="item.icon" :icon="item.icon" height="18" />
            <span
              v-if="getToolbarLabel(item)"
              class="text-sm font-medium leading-none"
              >{{ getToolbarLabel(item) }}</span
            >
          </Button>
          <Button
            sm
            square
            ghost
            @click="handleAiTask"
            :title="scoped(t('action.aiTask'))"
          >
            <Icon icon="mdi:robot-outline" height="18" />
          </Button>
          <Button
            sm
            square
            ghost
            @click="handleTranslation"
            :title="scoped(t('action.translation'))"
          >
            <Icon icon="mdi:translate" height="18" />
          </Button>
          <Button
            sm
            square
            ghost
            :disabled="!ipcStore.params.windowId"
            @click="handleInsertToWindow"
            :title="scoped(t('action.insertIntoWindow'))"
          >
            <Icon icon="mdi:application-export" height="18" />
          </Button>
        </div>
      </div>

      <!-- Main editor area -->
      <div class="editor-body">
        <!-- inert while dictating: keys and clicks belong to the voice bar -->
        <div class="editor-input-area" :inert="isInlineVoice">
          <EditorInput />
          <!-- the buttons act on the selection only: it must not go unnoticed -->
          <div
            v-if="!compact && editorInputStore.hasSelection"
            class="selection-chip"
            role="status"
          >
            <Icon icon="mdi:selection-drag" height="14" />
            {{
              t('editor.selectionScope', {
                count: editorInputStore.selectedText.length,
              })
            }}
          </div>
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
              :title="scoped(t('action.correction'))"
            >
              <Icon icon="mdi:auto-fix" height="20" />
            </Button>
            <div class="rail-divider" />
            <Button
              sm
              square
              ghost
              @click="handleCopy"
              :title="scoped(t('action.copy'))"
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
            <div class="rail-divider" />
            <InfoTooltip
              :text="t('editor.selectionHint')"
              align="end"
              placement="bottom"
            />
          </template>
        </div>
      </div>
    </div>

    <VoiceRecognitionMenu
      v-if="isInlineVoice"
      variant="bar"
      v-bind="menuModalsStore.currentModalParams"
      @cancelled="menuModalsStore.closeAll()"
      @corrected="menuModalsStore.closeAll()"
    />

    <div class="editor-footer">
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
          :disabled="item.selectionOnly && !editorInputStore.hasSelection"
          @click="doEdit(item)"
          >{{ getLabel(item) }}</Button
        >
      </div>

      <div
        v-if="!compact && isDev"
        class="dev-quick-panel flex items-center gap-1.5 w-full flex-wrap pt-2 border-t border-[var(--app-border-subtle)] text-xs text-[var(--app-text-muted)]"
      >
        <span class="font-mono font-medium">DEV Quick:</span>
        <Button sm neutral @click="openQuick('write')" title="Open Quick Write">
          <Icon icon="mdi:pencil-outline" height="15" />
          Write
        </Button>
        <Button
          sm
          neutral
          @click="openQuick('aiTasks')"
          title="Open Quick AI Tasks"
        >
          <Icon icon="mdi:robot-outline" height="15" />
          AI Tasks
        </Button>
        <Button
          sm
          neutral
          @click="openQuick('select')"
          title="Open Quick Select"
        >
          <Icon icon="mdi:format-list-checks" height="15" />
          Select
        </Button>
        <Button sm neutral @click="openQuick('voice')" title="Open Quick Voice">
          <Icon icon="mdi:microphone-outline" height="15" />
          Voice
        </Button>
      </div>

      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useCopyText } from '../composables/useCopyText'
import { useEditorActions } from '../composables/useEditorActions'
import { useI18n } from '../composables/useI18n'
import { desktopClient } from '../lib/desktop/client'
import { appNavigation } from '../lib/navigation/navigation'
import { resolveModeRoute } from '../lib/navigation/routes'
import type { ActionItem } from '../stores/actionMenu'
import { useActionMenuStore } from '../stores/actionMenu'
import type { EditItem } from '../stores/editMenu'
import { useEditMenuStore } from '../stores/editMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useToolbarStore } from '../stores/toolbar'
import type { ToolbarItem } from '../types/plugins'
import DropdownMenu, { type DropdownMenuItem } from './common/DropdownMenu.vue'
import InfoTooltip from './common/InfoTooltip.vue'
import VoiceRecognitionMenu from './menu/VoiceRecognitionMenu.vue'
import { Icon } from '@iconify/vue'
import type { START_MODES } from '@tyco/shared'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const actionMenuStore = useActionMenuStore()
const editorInputStore = useEditorInputStore()
const editMenuStore = useEditMenuStore()
const toolbarStore = useToolbarStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()
const { getLabel, voiceRecognition, doAction, doEdit } = useEditorActions()
const isDev = import.meta.env.DEV

/** The voice input runs in a bar under the editor, which stays in view */
const isInlineVoice = computed(
  () =>
    menuModalsStore.currentModal === MenuModals.VOICE_RECOGNITION &&
    Boolean(menuModalsStore.currentModalParams?.inline)
)
const copyText = useCopyText({ saveOutput: true })

const openQuick = async (mode: 'write' | 'voice' | 'aiTasks' | 'select') => {
  const text =
    editorInputStore.selectedText || editorInputStore.value || undefined

  const res = await ipcStore.callFunction('activateMode', [mode, text])
  if (!res?.success) {
    desktopClient.setLocalParams({
      mode: mode as unknown as START_MODES,
      selectedText: text ?? '',
      isWindowShown: true,
    })
    void appNavigation.push(resolveModeRoute(mode as unknown as START_MODES))
  }
}

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

const otherEditItems = computed(() => editMenuStore.getOtherEditItems())

const leftToolbarItems = computed(() => toolbarStore.getLeftToolbarItems())
const rightToolbarItems = computed(() => toolbarStore.getRightToolbarItems())

/** The label of a button that acts on the selection when there is one */
const scoped = (label: string): string =>
  editorInputStore.hasSelection
    ? t('editor.appliesToSelection', { action: label })
    : label

const getToolbarTooltip = (item: ToolbarItem): string => {
  if (item.tooltipKey) {
    return t(item.tooltipKey)
  }
  if (item.tooltip) {
    return item.tooltip
  }
  if (item.labelKey) {
    return t(item.labelKey)
  }
  return item.label || ''
}

const getToolbarLabel = (item: ToolbarItem): string => {
  if (item.label) return item.label
  if (item.labelKey) return t(item.labelKey)
  return ''
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
  // a plain copy: "copy and close" stays in the action menu
  await doAction({
    action: async (text) => {
      await copyText(text)
    },
  })
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

.editor-input-area {
  position: relative;
  flex: 1;
  min-width: 0;
}

.selection-chip {
  position: absolute;
  right: 0.5rem;
  bottom: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border: 1px solid color-mix(in oklab, var(--color-primary) 35%, transparent);
  border-radius: var(--radius-md);
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
  font-size: 0.75rem;
  /* the text below stays clickable and selectable */
  pointer-events: none;
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

.editor-root :deep(.btn-ghost:hover),
.editor-root :deep(.btn-ghost.btn-active) {
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
</style>
