<template>
  <div ref="hostRef" class="main-input textarea" />

  <EditorContextMenu
    v-if="menu"
    :x="menu.x"
    :y="menu.y"
    :items="menu.items"
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
  hasSelection,
  pasteFromClipboard,
  pastePlainFromClipboard,
} from '../lib/editor/clipboard'
import type {
  BubbleMenuRequest,
  ContextMenuRequest,
} from '../lib/editor/context-menu'
import { replaceRange } from '../lib/editor/context-menu'
import {
  createEditorState,
  setEditorSyntax,
} from '../lib/editor/create-editor-state'
import {
  applyStoreEdit,
  selectAll,
  setPlaceholder,
} from '../lib/editor/editor-sync'
import type { EditorMenuItem } from '../lib/editor/menu-item'
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
  /** Меню по ПКМ и меню выбора способа вставки перекрывают bubble-меню */
  kind: 'context' | 'paste' | 'bubble'
  x: number
  y: number
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
const showBubbleMenu = computed(
  () =>
    ipcStore.params.userConfig?.showBubbleMenu ??
    DEFAULT_USER_CONFIG.showBubbleMenu
)

const closeMenu = (): void => {
  menu.value = null
}

/** Обёртка над операциями с буфером обмена: без прав они бросают исключение */
const withClipboard = async (run: () => Promise<void>): Promise<void> => {
  try {
    await run()
  } catch {
    toast(t('editor.menu.clipboardUnavailable'), 'error')
  }
}

const clipboardItems = (request: ContextMenuRequest): EditorMenuItem[] => {
  const selected = Boolean(request.selectedText)

  return [
    {
      id: 'cut',
      label: t('editor.menu.cut'),
      icon: 'mdi:content-cut',
      disabled: !selected,
      separatorBefore: true,
      action: () => withClipboard(() => cutSelection(view!)),
    },
    {
      id: 'copy',
      label: t('editor.menu.copy'),
      icon: 'mdi:content-copy',
      disabled: !selected,
      action: () => withClipboard(() => copySelection(view!)),
    },
    {
      id: 'paste',
      label: t('editor.menu.paste'),
      icon: 'mdi:content-paste',
      action: () =>
        withClipboard(() => pasteFromClipboard(view!, pasteMode.value)),
    },
    {
      id: 'paste-plain',
      label: t('editor.menu.pasteAsText'),
      action: () => withClipboard(() => pastePlainFromClipboard(view!)),
    },
  ]
}

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
    items: [...spellcheckItems(request), ...clipboardItems(request)],
  }
}

/** Пункты bubble-меню — те же действия, что и в кнопках под редактором */
const bubbleItems = (): EditorMenuItem[] => [
  ...editMenuStore
    .getEditMenu()
    .map((item: EditItem, index: number) => ({
      id: `edit-${item.labelKey || item.name || index}`,
      label: getLabel(item),
      icon: item.icon,
      action: () => doEdit(item.action),
    })),
  ...actionMenuStore
    .getActionsMenu()
    .map((item: ActionItem, index: number) => ({
      id: `action-${item.labelKey || item.name || index}`,
      label: getLabel(item),
      icon: item.icon,
      disabled: item.disabled,
      separatorBefore: index === 0,
      action: () => doAction(item),
    })),
]

const updateBubbleMenu = (request: BubbleMenuRequest | null): void => {
  if (!request) {
    if (menu.value?.kind === 'bubble') closeMenu()

    return
  }

  if (!showBubbleMenu.value) return
  // меню по ПКМ и выбор способа вставки важнее
  if (menu.value && menu.value.kind !== 'bubble') return

  menu.value = {
    kind: 'bubble',
    x: request.x,
    y: request.y,
    items: bubbleItems(),
  }
}

const askPasteMode = (request: PasteAskRequest): void => {
  menu.value = {
    kind: 'paste',
    x: request.x,
    y: request.y,
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
      syntax: editorSyntax.value,
      paste: { getMode: () => pasteMode.value, onAsk: askPasteMode },
      onContextMenu: openContextMenu,
      onSelectionMenu: updateBubbleMenu,
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

// bubble-меню отключили в настройках
watch(
  () => showBubbleMenu.value,
  (enabled) => {
    if (!enabled && menu.value?.kind === 'bubble') closeMenu()
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

defineExpose({
  /** Заменить диапазон в документе — точка входа для будущего спеллчекера */
  replaceRange: (from: number, to: number, insert: string) => {
    if (view) replaceRange(view, from, to, insert)
  },
  hasSelection: () => (view ? hasSelection(view) : false),
})
</script>

<style scoped>
.main-input {
  /* daisyUI задаёт .textarea ширину clamp(3rem, 20rem, 100%) — редактор из-за
     неё занимал 20rem вместо всей доступной ширины */
  display: flex;
  width: 100%;
  max-width: none;
  height: 100%;
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.main-input:focus-within {
  border-color: oklch(var(--p));
  box-shadow: 0 0 0 2px oklch(var(--p) / 0.15);
  outline: none;
}

/* остальной вид редактора — в lib/editor/theme.ts, чтобы цвета брались из
   переменных темы приложения */
.main-input :deep(.cm-editor) {
  flex: 1;
  min-width: 0;
}
</style>
