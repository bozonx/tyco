<template>
  <div class="editor-root" :class="{ 'is-compact': compact }">
    <div class="editor-frame">
      <!-- Toolbar above editor -->
      <EditorToolbar
        v-show="!compact"
        @ask-ai="handleAskAi"
        @styling="handleStyling"
        @transformation="handleTransformation"
        @translation="handleTranslation"
        @insert-to-window="handleInsertToWindow"
      />

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
            <AppIcon icon="mdi:selection-drag" size="sm" />
            {{
              t('editor.selectionScope', {
                count: editorInputStore.selectedText.length,
              })
            }}
          </div>
        </div>
        <EditorRail
          :compact="compact"
          @voice-recognition="voiceRecognition"
          @correction="handleCorrection"
          @copy="handleCopy"
        />
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

      <EditorDevQuickPanel v-if="!compact && isDev" />

      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useCopyText } from '../../composables/use-copy-text'
import { useEditorActions } from '../../composables/use-editor-actions'
import { useI18n } from '../../composables/use-i18n'
import { useInlineVoiceStep } from '../../composables/use-inline-voice-step'
import { provideMarkupMode } from '../../composables/use-markup-mode'
import type { ActionItem } from '../../stores/action-menu'
import { useActionMenuStore } from '../../stores/action-menu'
import { useChatStore } from '../../stores/chat'
import { useEditMenuStore } from '../../stores/edit-menu'
import { useEditorInputStore } from '../../stores/editor-input'
import { useMenuModalsStore } from '../../stores/menu-modals'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import VoiceRecognitionMenu from '../menu/VoiceRecognitionMenu.vue'
import EditorDevQuickPanel from './EditorDevQuickPanel.vue'
import EditorInput from './EditorInput.vue'
import EditorRail from './EditorRail.vue'
import EditorToolbar from './EditorToolbar.vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const actionMenuStore = useActionMenuStore()
const editorInputStore = useEditorInputStore()
const chatStore = useChatStore()
const editMenuStore = useEditMenuStore()
const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()
const { getLabel, voiceRecognition, doAction, doEdit } = useEditorActions()
// the Markdown view lasts only while the page is open
provideMarkupMode()

const isDev = import.meta.env.DEV

const { voiceParams, isInlineVoice } = useInlineVoiceStep()
const copyText = useCopyText({ saveOutput: true })

const otherEditItems = computed(() => editMenuStore.getOtherEditItems())

const runMenuAction = async (labelKey: string) => {
  const item =
    actionMenuStore
      .getActionsMenu()
      .find((action: ActionItem) => action.labelKey === labelKey) ??
    actionMenuStore
      .getDefaultActions()
      .find((action: ActionItem) => action.labelKey === labelKey)
  if (item) {
    await doAction(item)
  }
}

const handleStyling = () => runMenuAction('action.stylingMenu')
const handleTransformation = () => runMenuAction('action.transformationMenu')

/** Opens the chat with the selection, or the whole text, attached */
const handleAskAi = async () => {
  const selection = editorInputStore.selectedText.trim()
  const text = selection || editorInputStore.value.trim()
  if (!text) return
  menuModalsStore.closeAll()
  await chatStore.attachToChat(
    text,
    selection ? 'editorSelection' : 'editorText'
  )
}

const handleInsertToWindow = () => runMenuAction('action.insertIntoWindow')
const handleTranslation = () => runMenuAction('action.translationMenu')
const handleCorrection = () => runMenuAction('action.correction')

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

.editor-footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  flex-shrink: 0;
}
</style>
