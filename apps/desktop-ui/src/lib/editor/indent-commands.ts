import { indentLess, indentMore } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import type { Command, KeyBinding } from '@codemirror/view'

/**
 * Four spaces nest an item under both `- ` and `1. ` in CommonMark: a nested
 * item has to start at the text of its parent, which is column 2 or 3.
 */
export const MARKDOWN_INDENT = '    '

export const markdownIndentUnit: Extension = indentUnit.of(MARKDOWN_INDENT)

/** A list or task item: Tab nests it wherever the caret is on its line */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/

const isOnListItem = (state: EditorState): boolean => {
  const { head } = state.selection.main

  return LIST_ITEM.test(state.doc.lineAt(head).text)
}

/**
 * Tab indents the selected lines or the list item under the caret, and inserts
 * spaces at the caret elsewhere. Escape followed by Tab still moves the focus
 * on, which is the way out of the editor for keyboard users (CodeMirror's tab
 * focus mode).
 */
export const indentOrInsertTab: Command = (view) => {
  const { empty } = view.state.selection.main

  if (!empty || isOnListItem(view.state)) return indentMore(view)

  view.dispatch(
    view.state.update(
      view.state.replaceSelection(view.state.facet(indentUnit)),
      { scrollIntoView: true, userEvent: 'input' }
    )
  )

  return true
}

export const indentKeymap: KeyBinding[] = [
  { key: 'Tab', run: indentOrInsertTab, shift: indentLess },
]
