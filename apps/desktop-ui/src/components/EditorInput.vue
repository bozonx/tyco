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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorActions } from '../composables/useEditorActions'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import {
  copySelection,
  cutSelection,
  pasteFromClipboard,
  pastePlainFromClipboard,
} from '../lib/editor/clipboard'
import type { ContextMenuRequest } from '../lib/editor/context-menu'
import {
  createEditorState,
  setEditorSyntax,
} from '../lib/editor/create-editor-state'
import {
  applyStoreEdit,
  selectAll,
  setPlaceholder,
} from '../lib/editor/editor-sync'
import type {
  EditorMenuCommands,
  EditorMenuGroups,
} from '../lib/editor/menu-builder'
import { actionIcon, buildContextMenu } from '../lib/editor/menu-builder'
import type { EditorMenuItem, MenuPlacement } from '../lib/editor/menu-item'
import type { PasteAskRequest } from '../lib/editor/paste'
import type { ActionItem } from '../stores/actionMenu'
import { useActionMenuStore } from '../stores/actionMenu'
import type { EditItem } from '../stores/editMenu'
import { useEditMenuStore } from '../stores/editMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menuModals'
import { useRouteParams } from '../stores/routeParams'
import { EditorView } from '@codemirror/view'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'

const editorInputStore = useEditorInputStore()
const routeParamsStore = useRouteParams()
const menuModalsStore = useMenuModalsStore()
const actionMenuStore = useActionMenuStore()
const editMenuStore = useEditMenuStore()
const ipcStore = useIpcStore()
const { toast } = useToast()
const { t } = useI18n()
const { getLabel, doAction, doEdit } = useEditorActions()

const hostRef = ref<HTMLElement | null>(null)

interface OpenMenu {
  kind: 'context' | 'paste'
  x: number
  y: number
  bottom: number
  placement: MenuPlacement
  items: EditorMenuItem[]
}

const menu = ref<OpenMenu | null>(null)

let view: EditorView | null = null

// настройки редактора; у конфигов, созданных до появления ключей, берём дефолты
const pasteMode = computed(
  () => ipcStore.params.userConfig?.pasteMode ?? DEFAULT_USER_CONFIG.pasteMode
)
const editorSyntax = computed(
  () =>
    ipcStore.params.userConfig?.editorSyntax ?? DEFAULT_USER_CONFIG.editorSyntax
)

const closeMenu = (restoreFocus = false): void => {
  menu.value = null

  // the menu took keyboard focus, so the editor has to get it back
  if (restoreFocus) view?.focus()
}

/** Обёртка над операциями с буфером обмена: без прав они бросают исключение */
const withClipboard = async (run: () => Promise<void>): Promise<void> => {
  try {
    await run()
  } catch {
    toast(t('editor.menu.clipboardUnavailable'), 'error')
  }
}

const commands: EditorMenuCommands = {
  cut: () => withClipboard(() => cutSelection(view!)),
  copy: () => withClipboard(() => copySelection(view!)),
  paste: () => withClipboard(() => pasteFromClipboard(view!, pasteMode.value)),
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
    action: () => doEdit(item.action),
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
})

/**
 * Варианты исправления слова. Спеллчекер появится этапом позже
 * (`dev_docs/plan-spellcheck.md`) — до тех пор этих пунктов в меню нет
 */
const spellcheckItems = (_request: ContextMenuRequest): EditorMenuItem[] => []

const openContextMenu = (request: ContextMenuRequest): void => {
  if (!view) return

  menu.value = {
    kind: 'context',
    x: request.x,
    y: request.y,
    bottom: request.bottom,
    placement: 'point',
    items: buildContextMenu({
      t,
      commands,
      groups: menuGroups(),
      selected: Boolean(request.selectedText),
      suggestions: spellcheckItems(request),
    }),
  }
}

const askPasteMode = (request: PasteAskRequest): void => {
  menu.value = {
    kind: 'paste',
    x: request.x,
    y: request.y,
    bottom: request.bottom,
    placement: 'below',
    items: [
      {
        id: 'paste-markdown',
        label: t('editor.menu.pasteFormatted'),
        icon: 'mdi:language-markdown',
        accent: true,
        action: () => {
          request.apply(request.markdown)
          view?.focus()
        },
      },
      {
        id: 'paste-plain',
        label: t('editor.menu.pasteAsText'),
        action: () => {
          request.apply(request.plain)
          view?.focus()
        },
      },
    ],
  }
}

onMounted(() => {
  if (routeParamsStore.params.text) {
    editorInputStore.setValue(routeParamsStore.params.text)
  }

  if (!hostRef.value) return

  view = new EditorView({
    parent: hostRef.value,
    state: createEditorState({
      doc: editorInputStore.value,
      placeholder: t('input.textPlaceholder'),
      ariaLabel: t('editor.inputLabel'),
      syntax: editorSyntax.value,
      paste: { getMode: () => pasteMode.value, onAsk: askPasteMode },
      onContextMenu: openContextMenu,
      onDocChange: (value) => editorInputStore.setValue(value),
      onSelectionChange: (text, start, end) =>
        editorInputStore.setSelection(text, start, end),
    }),
  })

  editorInputStore.focus()
})

onUnmounted(() => {
  view?.destroy()
  view = null
})

// значение и выделение стора -> редактор одной транзакцией: иначе результат
// AI-правки разъехался бы на два шага Ctrl+Z. Свои же правки отсекаются
// сравнением с документом
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

// смена языка
watch(
  () => t('input.textPlaceholder'),
  (text) => {
    if (view) setPlaceholder(view, text)
  }
)

// смена режима подсветки в настройках
watch(
  () => editorSyntax.value,
  (mode) => {
    if (view) setEditorSyntax(view, mode)
  }
)

// set focus on close modal
watch(
  () => menuModalsStore.anyModalOpen,
  (value) => {
    if (!value) editorInputStore.focus()
  }
)

// handle focus
watch(
  () => editorInputStore.focusCount,
  (newValue, oldValue) => {
    if (newValue > oldValue) view?.focus()
  }
)

// handle select all
watch(
  () => editorInputStore.selectAllCount,
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

/* остальной вид редактора — в lib/editor/theme.ts, чтобы цвета брались из
   переменных темы приложения */
.main-input :deep(.cm-editor) {
  flex: 1;
  min-width: 0;
  height: 100%;
  outline: none;
}
</style>
