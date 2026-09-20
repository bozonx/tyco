import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import type { EditorSyntax } from '@shared'

import type { EditorMenusOptions } from './contextMenu'
import { editorMenusExtension } from './contextMenu'
import type { PasteOptions } from './paste'
import { pasteExtension } from './paste'
import { syntaxCompartment, syntaxExtension } from './syntax'
import { editorAppearance } from './theme'

/**
 * Помечает транзакции, которые редактор получил из стора. Слушатель обновлений
 * их игнорирует — иначе изменение стора вернулось бы в стор же (эхо)
 */
export const fromStore = Annotation.define<boolean>()

/**
 * Компартмент плейсхолдера — чтобы менять его при смене языка без пересоздания
 * редактора
 */
export const placeholderCompartment = new Compartment()

export interface EditorCallbacks {
  /** Пользователь изменил текст */
  onDocChange?: (value: string) => void
  /** Пользователь изменил выделение или каретку */
  onSelectionChange?: (text: string, start: number, end: number) => void
}

export interface CreateEditorStateOptions
  extends EditorCallbacks,
    EditorMenusOptions {
  doc?: string
  placeholder?: string
  /** Режим подсветки документа */
  syntax?: EditorSyntax
  /** Обработка вставки из буфера обмена; не задана — вставка остаётся нативной */
  paste?: PasteOptions
}

/** Набор расширений редактора */
export const createEditorExtensions = (
  options: CreateEditorStateOptions = {}
): Extension[] => [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.lineWrapping,
  EditorState.allowMultipleSelections.of(false),
  EditorView.contentAttributes.of({ spellcheck: 'false' }),
  placeholderCompartment.of(placeholder(options.placeholder ?? '')),
  syntaxCompartment.of(syntaxExtension(options.syntax ?? 'markdown')),
  editorAppearance,
  ...(options.paste ? [pasteExtension(options.paste)] : []),
  editorMenusExtension({
    onContextMenu: options.onContextMenu,
    onSelectionMenu: options.onSelectionMenu,
  }),
  EditorView.updateListener.of((update) => {
    // правки, пришедшие из стора, наружу не отдаём
    if (update.transactions.some((tr) => tr.annotation(fromStore))) return

    if (update.docChanged) {
      options.onDocChange?.(update.state.doc.toString())
    }

    if (update.docChanged || update.selectionSet) {
      const { from, to } = update.state.selection.main

      options.onSelectionChange?.(
        from === to ? '' : update.state.sliceDoc(from, to),
        from,
        to
      )
    }
  }),
]

export const createEditorState = (
  options: CreateEditorStateOptions = {}
): EditorState =>
  EditorState.create({
    doc: options.doc ?? '',
    extensions: createEditorExtensions(options),
  })

/** Сменить режим подсветки без пересоздания редактора */
export const setEditorSyntax = (view: EditorView, mode: EditorSyntax): void => {
  view.dispatch({
    effects: syntaxCompartment.reconfigure(syntaxExtension(mode)),
    annotations: fromStore.of(true),
  })
}
