<template>
  <div ref="hostRef" class="main-input" />

  <EditorContextMenu
    v-if="menu"
    :x="menu.x"
    :y="menu.y"
    :bottom="menu.bottom"
    :items="menu.items"
    :placement="menu.placement"
    @close="closeMenu"
  />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorActions } from '../../composables/use-editor-actions'
import { useI18n } from '../../composables/use-i18n'
import { useMarkupMode } from '../../composables/use-markup-mode'
import useToast from '../../composables/use-toast'
import {
  StaleClipboardError,
  copySelection,
  cutSelection,
  pasteFromClipboard,
  pastePlainFromClipboard,
} from '../../lib/editor/clipboard'
import type { ContextMenuRequest } from '../../lib/editor/context-menu'
import { createEditorState } from '../../lib/editor/create-editor-state'
import {
  openEditorSearch,
  setEditorPhrases,
} from '../../lib/editor/editor-search'
import {
  applyStoreEdit,
  selectAll,
  setPlaceholder,
} from '../../lib/editor/editor-sync'
import { markdownCommands } from '../../lib/editor/markdown-commands'
import { setMarkdownPreview } from '../../lib/editor/markdown-preview'
import { buildMarkupItems } from '../../lib/editor/markup-menu'
import type {
  EditorMenuCommands,
  EditorMenuGroups,
} from '../../lib/editor/menu-builder'
import { actionIcon, buildContextMenu } from '../../lib/editor/menu-builder'
import type { EditorMenuItem, MenuPlacement } from '../../lib/editor/menu-item'
import type { ActionItem } from '../../stores/action-menu'
import { useActionMenuStore } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import type { EditItem } from '../../stores/edit-menu'
import { useEditMenuStore } from '../../stores/edit-menu'
import { useEditorInputStore } from '../../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import EditorContextMenu from './EditorContextMenu.vue'
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'

const editorInputStore = useEditorInputStore()
const menuModalsStore = useMenuModalsStore()
const actionMenuStore = useActionMenuStore()
const editMenuStore = useEditMenuStore()
const desktopStore = useDesktopStore()
const { toastKey } = useToast()
const { t } = useI18n()
const { getLabel, doAction, doEdit } = useEditorActions()

const hostRef = ref<HTMLElement | null>(null)

interface OpenMenu {
  x: number
  y: number
  bottom: number
  placement: MenuPlacement
  items: EditorMenuItem[]
}

const menu = ref<OpenMenu | null>(null)

const { isMarkupShown, toggleShowMarkup } = useMarkupMode()

let view: EditorView | null = null

const closeMenu = (restoreFocus = false): void => {
  menu.value = null

  // the menu took keyboard focus, so the editor has to get it back
  if (restoreFocus) view?.focus()
}

/** Wrapper around clipboard operations: throws exception if access is denied */
const withClipboard = async (run: () => Promise<void>): Promise<void> => {
  try {
    await run()
  } catch (error) {
    if (error instanceof StaleClipboardError)
      toastKey('toast.textTransformStale', 'warn')
    else toastKey('editor.menu.clipboardUnavailable', 'error')
  }
}

const commands: EditorMenuCommands = {
  search: () => {
    if (view) openEditorSearch(view)
  },
  undo: () => {
    if (!view) return

    undo(view)
    view.focus()
  },
  redo: () => {
    if (!view) return

    redo(view)
    view.focus()
  },
  cut: () => withClipboard(() => cutSelection(view!)),
  copy: () => withClipboard(() => copySelection(view!)),
  paste: () =>
    withClipboard(() =>
      pasteFromClipboard(view!, desktopStore.userConfig.markdown.format)
    ),
  pastePlain: () => withClipboard(() => pastePlainFromClipboard(view!)),
  selectAll: () => {
    if (!view) return

    selectAll(view)
    view.focus()
  },
}

const editItems = (items: EditItem[], group: string): EditorMenuItem[] =>
  items.map((item, index) => ({
    id: `${group}-${item.id || item.labelKey || item.name || index}`,
    label: getLabel(item),
    icon: item.icon,
    disabled: item.selectionOnly && !editorInputStore.hasSelection,
    action: () => doEdit(item),
  }))

/** Transforms and actions — the same ones as the buttons around the editor */
const menuGroups = (): EditorMenuGroups => ({
  caseItems: editItems(editMenuStore.getCaseItems(), 'case'),
  formatItems: editItems(editMenuStore.getFormatItems(), 'format'),
  otherEditItems: editItems(editMenuStore.getOtherEditItems(), 'edit'),
  actionItems: actionMenuStore
    .getActionsMenu()
    .map((item: ActionItem, index: number) => ({
      id: item.id || item.labelKey || item.name || `action-${index}`,
      label: getLabel(item),
      icon: actionIcon(item.id, item.icon),
      disabled: item.disabled,
      action: () => doAction(item),
    })),
  markupItems: buildMarkupItems({
    t,
    run: (command) => {
      if (!view) return

      markdownCommands[command](view)
      view.focus()
    },
    isMarkupShown: isMarkupShown.value,
    toggleShowMarkup,
  }),
})

/**
 * Word correction suggestions. Spellchecker will appear in a later stage
 * (`dev_docs/plan-spellcheck.md`) — until then, these menu items are omitted.
 */
const spellcheckItems = (_request: ContextMenuRequest): EditorMenuItem[] => []

const openContextMenu = (request: ContextMenuRequest): void => {
  if (!view) return

  menu.value = {
    x: request.x,
    y: request.y,
    bottom: request.bottom,
    placement: 'point',
    items: buildContextMenu({
      t,
      commands,
      groups: menuGroups(),
      selected: Boolean(request.selectedText),
      canUndo: undoDepth(view.state) > 0,
      canRedo: redoDepth(view.state) > 0,
      suggestions: spellcheckItems(request),
    }),
  }
}

function openInsertMenu(): void {
  if (menuModalsStore.hasOpenModal || menuModalsStore.pendingModal) return
  editorInputStore.captureResultSource(editorInputStore.actionText())
  menuModalsStore.nextModal(MenuModals.INSERT, {
    text: editorInputStore.actionText(),
  })
}

onMounted(() => {
  if (!hostRef.value) return

  view = new EditorView({
    parent: hostRef.value,
    state: createEditorState({
      doc: editorInputStore.value,
      placeholder: t('input.textPlaceholder'),
      ariaLabel: t('editor.inputLabel'),
      t,
      paste: true,
      getMarkdownSettings: () => desktopStore.userConfig.markdown.format,
      onPastePlain: () => void commands.pastePlain(),
      markdownPreview: !isMarkupShown.value,
      onToggleMarkup: toggleShowMarkup,
      onOpenActions: openInsertMenu,
      onContextMenu: openContextMenu,
      onDocChange: (value) => editorInputStore.setValue(value),
      onSelectionChange: (text, start, end) =>
        editorInputStore.setSelection(text, start, end),
    }),
  })

  editorInputStore.requestFocus()
})

onUnmounted(() => {
  view?.destroy()
  view = null
})

// Store value and selection -> editor in one transaction: otherwise AI
// edits would split into two Ctrl+Z steps. Own edits are skipped
// by comparing with the document.
watch(
  () => [
    editorInputStore.value,
    editorInputStore.selectionStart,
    editorInputStore.selectionEnd,
  ],
  () => {
    if (!view) return

    applyStoreEdit(view, {
      value: editorInputStore.value,
      selectionStart: editorInputStore.selectionStart,
      selectionEnd: editorInputStore.selectionEnd,
      source: editorInputStore.lastEditSource,
    })
  }
)

watch(isMarkupShown, (show) => {
  if (view) setMarkdownPreview(view, !show)
})

// Language change
watch(
  () => t('input.textPlaceholder'),
  (text) => {
    if (view) {
      setPlaceholder(view, text)
      setEditorPhrases(view, t)
      setMarkdownPreview(view, !isMarkupShown.value)
    }
  }
)

// set focus on close modal
watch(
  () => menuModalsStore.hasOpenModal,
  (value) => {
    if (!value) editorInputStore.requestFocus()
  }
)

// handle focus
watch(
  () => editorInputStore.focusRequestCount,
  (newValue, oldValue) => {
    if (newValue > oldValue) view?.focus()
  }
)

// handle select all
watch(
  () => editorInputStore.searchRequestCount,
  () => {
    if (view) openEditorSearch(view)
  }
)

watch(
  () => editorInputStore.selectAllRequestCount,
  (newValue, oldValue) => {
    if (newValue > oldValue && view) {
      selectAll(view)
      view.focus()
    }
  }
)
</script>

<style scoped>
.main-input {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: none;
  outline: none;
  background-color: transparent;
}

/* Remaining editor styling is in lib/editor/theme.ts, so colors are pulled
   from app theme CSS variables */
.main-input :deep(.cm-editor) {
  flex: 1;
  min-width: 0;
  height: 100%;
  outline: none;
}
</style>
