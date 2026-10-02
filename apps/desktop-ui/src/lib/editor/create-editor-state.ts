import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
} from '@codemirror/view'
import type { EditorSyntax } from '@tyco/shared'

import type { EditorMenusOptions } from './context-menu'
import { editorMenusExtension } from './context-menu'
import type { PasteOptions } from './paste'
import { pasteExtension } from './paste'
import { syntaxCompartment, syntaxExtension } from './syntax'
import { editorAppearance } from './theme'

/**
 * Marks transactions received by the editor from the store. The update listener
 * ignores them to prevent sending store changes back to the store (echo).
 */
export const fromStore = Annotation.define<boolean>()

/**
 * Placeholder compartment allowing language change without recreating the
 * editor instance.
 */
export const placeholderCompartment = new Compartment()

export interface EditorCallbacks {
  /** User changed text */
  onDocChange?: (value: string) => void
  /** User changed selection or cursor position */
  onSelectionChange?: (text: string, start: number, end: number) => void
}

export interface CreateEditorStateOptions
  extends EditorCallbacks, EditorMenusOptions {
  doc?: string
  placeholder?: string
  /** Syntax highlighting mode */
  syntax?: EditorSyntax
  /** Clipboard paste handling; if omitted, paste remains native */
  paste?: PasteOptions
  /** Accessible name of the input, announced by screen readers */
  ariaLabel?: string
}

/** Set of editor extensions */
export const createEditorExtensions = (
  options: CreateEditorStateOptions = {}
): Extension[] => [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.lineWrapping,
  EditorState.allowMultipleSelections.of(false),
  // shows an insertion point while text is dragged into the editor
  dropCursor(),
  // control characters pasted from the clipboard would be invisible otherwise
  highlightSpecialChars(),
  EditorView.contentAttributes.of({
    spellcheck: 'false',
    ...(options.ariaLabel ? { 'aria-label': options.ariaLabel } : {}),
  }),
  placeholderCompartment.of(placeholder(options.placeholder ?? '')),
  syntaxCompartment.of(syntaxExtension(options.syntax ?? 'markdown')),
  editorAppearance,
  ...(options.paste ? [pasteExtension(options.paste)] : []),
  editorMenusExtension({ onContextMenu: options.onContextMenu }),
  EditorView.updateListener.of((update) => {
    // do not emit updates originating from the store
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

/** Switch syntax highlighting mode without recreating the editor */
export const setEditorSyntax = (view: EditorView, mode: EditorSyntax): void => {
  view.dispatch({
    effects: syntaxCompartment.reconfigure(syntaxExtension(mode)),
    annotations: fromStore.of(true),
  })
}
