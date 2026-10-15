<template>
  <div class="editor-root" :class="{ 'is-compact': compact }">
    <div class="editor-frame">
      <!-- Toolbar above editor -->
      <div
        v-show="!compact"
        class="editor-toolbar flex items-center justify-between gap-2"
      >
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
            :icon="
              showMarkup ? 'mdi:language-markdown-outline' : 'mdi:format-text'
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
          <DropdownMenu
            :label="t('editor.format')"
            :items="formatDropdownItems"
          />
          <Button
            v-for="item in leftToolbarItems"
            :key="item.id"
            size="sm"
            :square="
              !getToolbarLabel(item) || getToolbarLabel(item).length <= 2
            "
            variant="ghost"
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

        <!-- Right column: plugin items, then Ask AI, AI task, Translation & Insert to window -->
        <div data-testid="editor-toolbar-right" class="flex items-center gap-1">
          <Button
            v-for="item in rightToolbarItems"
            :key="item.id"
            size="sm"
            :square="
              !getToolbarLabel(item) || getToolbarLabel(item).length <= 2
            "
            variant="ghost"
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
          <IconButton
            size="sm"
            variant="ghost"
            class="ask-ai"
            :disabled="!editorInputStore.value.trim()"
            @click="handleAskAi"
            :label="scoped(t('editor.askAi'))"
            icon="mdi:chat-question-outline"
          />
          <IconButton
            size="sm"
            variant="ghost"
            @click="handleAiTask"
            :label="scoped(t('action.aiTask'))"
            icon="mdi:robot-outline"
          />
          <IconButton
            size="sm"
            variant="ghost"
            @click="handleTranslation"
            :label="scoped(t('action.translation'))"
            icon="mdi:translate"
          />
          <IconButton
            size="sm"
            variant="ghost"
            :disabled="!ipcStore.desktopState.windowId"
            @click="handleInsertToWindow"
            :label="scoped(t('action.insertIntoWindow'))"
            icon="mdi:application-export"
          />
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
            <IconButton
              size="sm"
              variant="danger-ghost"
              @click="editorInputStore.clear"
              :label="t('editor.clear')"
              icon="mdi:eraser"
            />
          </template>
          <template v-else>
            <IconButton
              size="sm"
              variant="ghost"
              tone="accent"
              @click="voiceRecognition"
              :label="t('editor.voiceInput')"
              icon="mdi:microphone-outline"
            />
            <IconButton
              size="sm"
              variant="ghost"
              tone="accent"
              @click="handleCorrection"
              :label="scoped(t('action.correction'))"
              icon="mdi:auto-fix"
            />
            <div class="rail-divider" />
            <IconButton
              size="sm"
              variant="ghost"
              @click="handleCopy"
              :label="scoped(t('action.copy'))"
              icon="mdi:content-copy"
            />
            <IconButton
              size="sm"
              variant="ghost"
              @click="editorInputStore.requestSelectAll"
              :label="t('editor.selectAll')"
              icon="mdi:select-all"
            />
            <IconButton
              size="sm"
              variant="danger-ghost"
              @click="editorInputStore.clear"
              :label="t('editor.clear')"
              icon="mdi:eraser"
            />
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
      v-bind="voiceParams"
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
          size="sm"
          variant="neutral"
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
        <Button
          size="sm"
          variant="neutral"
          @click="openQuick(StartMode.VOICE_COMMANDS)"
          title="Open Quick Voice Commands"
        >
          <Icon icon="mdi:microphone-message" height="15" />
          Voice Commands
        </Button>
        <Button
          size="sm"
          variant="neutral"
          @click="openQuick(StartMode.WRITE)"
          title="Open Quick Write"
        >
          <Icon icon="mdi:pencil-outline" height="15" />
          Write
        </Button>
        <Button
          size="sm"
          variant="neutral"
          @click="openQuick(StartMode.AI_TASKS)"
          title="Open Quick AI Tasks"
        >
          <Icon icon="mdi:robot-outline" height="15" />
          AI Tasks
        </Button>
        <Button
          size="sm"
          variant="neutral"
          @click="openQuick(StartMode.SELECT)"
          title="Open Quick Select"
        >
          <Icon icon="mdi:format-list-checks" height="15" />
          Select
        </Button>
        <Button
          size="sm"
          variant="neutral"
          @click="openQuick(StartMode.VOICE)"
          title="Open Quick Voice"
        >
          <Icon icon="mdi:microphone-outline" height="15" />
          Voice
        </Button>
        <Button
          size="sm"
          variant="neutral"
          @click="openQuick(StartMode.COMMAND_LAUNCHER)"
          title="Open Quick Commands"
        >
          <Icon icon="mdi:console-line" height="15" />
          Commands
        </Button>
        <Button
          size="sm"
          variant="neutral"
          @click="openQuick(StartMode.TRANSLATE)"
          title="Open Quick Translate"
        >
          <Icon icon="mdi:translate" height="15" />
          Translate
        </Button>
        <Button
          size="sm"
          variant="neutral"
          @click="openQuick(StartMode.CORRECTION)"
          title="Open Quick Correction"
        >
          <Icon icon="mdi:text-box-edit-outline" height="15" />
          Correction
        </Button>
      </div>

      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount } from 'vue'

import { useCopyText } from '../../composables/use-copy-text'
import { useEditorActions } from '../../composables/use-editor-actions'
import { useI18n } from '../../composables/use-i18n'
import { desktopClient } from '../../lib/desktop/client'
import { appNavigation } from '../../lib/navigation/navigation'
import { resolveModeRoute } from '../../lib/navigation/routes'
import type { ActionItem } from '../../stores/action-menu'
import { useActionMenuStore } from '../../stores/action-menu'
import { useChatStore } from '../../stores/chat'
import type { EditItem } from '../../stores/edit-menu'
import { useEditMenuStore } from '../../stores/edit-menu'
import { useEditorInputStore } from '../../stores/editor-input'
import { useIpcStore } from '../../stores/ipc'
import { useMarkupModeStore } from '../../stores/markup-mode'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useToolbarStore } from '../../stores/toolbar'
import type { ToolbarItem } from '../../types/plugins'
import Icon from '../common/AppIcon.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import VoiceRecognitionMenu from '../menu/VoiceRecognitionMenu.vue'
import { StartMode } from '@tyco/shared'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const actionMenuStore = useActionMenuStore()
const editorInputStore = useEditorInputStore()
const chatStore = useChatStore()
const editMenuStore = useEditMenuStore()
const toolbarStore = useToolbarStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()
const { getLabel, voiceRecognition, doAction, doEdit } = useEditorActions()
const markupMode = useMarkupModeStore()
const { showMarkup } = storeToRefs(markupMode)
const { toggleShowMarkup, resetShowMarkup } = markupMode
// the Markdown view lasts only while the page is open
onBeforeUnmount(resetShowMarkup)

const viewModeTitle = computed(() =>
  t(
    showMarkup.value
      ? 'editor.markup.switchToFormatted'
      : 'editor.markup.switchToSource'
  )
)
const isDev = import.meta.env.DEV

/** The voice input runs in a bar under the editor, which stays in view */
const voiceParams = computed(() => {
  const step = menuModalsStore.currentStep
  return step?.modal === MenuModals.VOICE_RECOGNITION ? step.params : undefined
})
const isInlineVoice = computed(() => Boolean(voiceParams.value?.inline))
const copyText = useCopyText({ saveOutput: true })

const openQuick = async (mode: StartMode) => {
  const text =
    editorInputStore.selectedText || editorInputStore.value || undefined

  const res = await ipcStore.callFunction('activateMode', [mode, text])
  if (!res?.success) {
    desktopClient.setLocalParams({
      mode: mode,
      selectedText: text ?? '',
      isWindowShown: true,
    })
    void appNavigation.push(resolveModeRoute(mode))
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

/** Opens the chat with the selection, or the whole text, attached */
const handleAskAi = async () => {
  const selection = editorInputStore.selectedText.trim()
  const text = selection || editorInputStore.value.trim()
  if (!text) return
  menuModalsStore.closeAll()
  await chatStore.attachToChat(
    text,
    selection ? 'editor-selection' : 'editor-text'
  )
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
  --button-ghost-color: var(--app-text-muted);
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

.editor-toolbar > div:first-child {
  min-width: 0;
  flex-wrap: wrap;
}

.editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
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
  font-size: var(--text-caption);
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

.editor-footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  flex-shrink: 0;
}
</style>
