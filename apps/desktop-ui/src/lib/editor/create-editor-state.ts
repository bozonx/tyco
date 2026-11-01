import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
} from '@codemirror/view'

import type { EditorMenusOptions } from './context-menu'
import { editorMenusExtension } from './context-menu'
import { historyKeysExtension } from './history-keys'
import { markdownIndentUnit } from './indent-commands'
import { editorSearch } from './editor-search'
import { translate } from '../i18n'
import { editorShortcutsExtension } from './editor-shortcuts'
import { DEFAULT_USER_CONFIG, type EditorShortcuts } from '@tyco/shared'
import { markdownPreview } from './markdown-preview'
import { pasteExtension } from './paste'
import { editorHighlightStyle, editorTheme } from './theme'

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

interface EditorCallbacks {
  /** User changed text */
  onDocChange?: (value: string) => void
  /** User changed selection or cursor position */
  onSelectionChange?: (text: string, start: number, end: number) => void
}

export interface CreateEditorStateOptions
  extends EditorCallbacks, EditorMenusOptions {
  getEditorShortcuts?: () => EditorShortcuts
  doc?: string
  placeholder?: string
  /** Convert pasted HTML into Markdown; if omitted, paste remains native */
  paste?: boolean
  getMarkdownSettings?: () => unknown
  /** Paste the clipboard as plain text (Mod-Shift-v) */
  onPastePlain?: () => void
  /** Accessible name of the input, announced by screen readers */
  ariaLabel?: string
  t?: (key: string) => string
  /**
   * Hide the markup outside the lines being edited; `setMarkdownPreview`
   * switches it later
   */
  markdownPreview?: boolean
  /** Switch between the formatted look and the raw Markdown (Mod-Shift-m) */
  onToggleMarkup?: () => void
  /** Open quick actions panel (Mod-Enter) */
  onOpenActions?: () => void
}

const actionsKeymap = (onActions: () => void): Extension =>
  keymap.of([
    {
      key: 'Mod-Enter',
      run: () => {
        onActions()
        return true
      },
    },
  ])

/** Set of editor extensions */
export const createEditorExtensions = (
  options: CreateEditorStateOptions = {}
): Extension[] => [
  history(),
  historyKeysExtension(),
  editorSearch(options.t ?? translate),
  ...(options.onOpenActions ? [actionsKeymap(options.onOpenActions)] : []),
  // Mod-i belongs to configurable italic formatting, not syntax navigation.
  keymap.of([
    ...defaultKeymap.filter((binding) => binding.key !== 'Mod-i'),
    ...historyKeymap,
  ]),
  markdownIndentUnit,
  editorShortcutsExtension(
    options.getEditorShortcuts ?? (() => DEFAULT_USER_CONFIG.editor.shortcuts),
    options.onToggleMarkup
  ),
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
  // fenced code blocks are highlighted by their language
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  syntaxHighlighting(editorHighlightStyle),
  markdownPreview(options.markdownPreview ?? false),
  editorTheme,
  ...(options.paste
    ? [pasteExtension(options.getMarkdownSettings, options.onPastePlain)]
    : []),
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
