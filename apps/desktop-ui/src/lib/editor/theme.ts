import { HighlightStyle } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { tags } from '@lezer/highlight'

interface InternalEditorView {
  observer?: { ignore: (fn: () => void) => void }
  docView?: { forceSelection: boolean; updateSelection: () => void }
}

/**
 * When scrolling a virtualized document with a multi-screen selection (such as
 * after Ctrl+A), CodeMirror pins 1-line mini-viewports for the selection anchor
 * and head and reuses their DOM nodes while mounting newly visible lines in
 * between. Because both endpoint nodes and offsets remain identical:
 *
 * 1. CodeMirror's `docView.updateSelection` sees equivalent endpoints and skips
 *    re-applying the DOM selection.
 * 2. Even if `Selection` is re-applied to the same DOM nodes, WebKit's
 *    `RenderSelection::set` sees unchanged start/end `RenderObject*` pointers
 *    and returns early without marking newly inserted intermediate lines as
 *    selected (`SelectionState::Inside`).
 *
 * Re-attaching one endpoint node inside `observer.ignore` recreates its
 * `RenderObject` without triggering mutation records, and `forceSelection`
 * makes CodeMirror re-apply the native DOM selection across all visible lines.
 */
const refreshRedrawnSelection = ViewPlugin.fromClass(
  class {
    docViewUpdate(view: EditorView): void {
      if (view.state.selection.main.empty) return

      const root = view.root as Document & {
        getSelection?: () => Selection | null
      }
      const sel =
        (typeof root.getSelection === 'function'
          ? root.getSelection()
          : null) ?? window.getSelection()
      if (!sel) return

      const endpoint =
        sel.anchorNode &&
        sel.anchorNode !== view.contentDOM &&
        view.contentDOM.contains(sel.anchorNode)
          ? sel.anchorNode
          : sel.focusNode &&
              sel.focusNode !== view.contentDOM &&
              view.contentDOM.contains(sel.focusNode)
            ? sel.focusNode
            : null
      const parent = endpoint?.parentNode
      if (!endpoint || !parent) return

      const internal = view as unknown as InternalEditorView
      const reattach = (): void => {
        const next = endpoint.nextSibling
        parent.removeChild(endpoint)
        parent.insertBefore(endpoint, next)
      }

      if (internal.observer) internal.observer.ignore(reattach)
      else reattach()

      if (internal.docView) {
        internal.docView.forceSelection = true
        internal.docView.updateSelection()
      }
    }
  }
)

/**
 * Editor theme. All colors are application CSS variables, so light and dark
 * themes toggle by changing `data-theme` on `<html>`, without recreating the
 * editor.
 */
export const editorTheme: Extension = [
  EditorView.theme({
    '&': {
      height: '100%',
      width: '100%',
      color: 'inherit',
      backgroundColor: 'transparent',
      fontFamily: 'var(--editor-font-family)',
      fontSize: 'var(--editor-font-size)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      // writer look: proportional font and generous line-height
      // rather than monospace code editor appearance
      fontFamily: 'var(--editor-font-family)',
      fontSize: 'var(--editor-font-size)',
      lineHeight: 'var(--editor-line-height)',
      overflow: 'auto',
      overscrollBehavior: 'contain',
    },
    '.cm-content': {
      padding: 'var(--editor-padding)',
      caretColor: 'var(--color-primary)',
    },
    '.cm-line': { padding: '0' },
    '.cm-placeholder': { color: 'var(--app-text-faint)' },
    // `drawSelection` is deliberately not enabled: a single-cursor text buffer is
    // better served by the native caret and selection, which behave correctly
    // with IME. Hence the caret is styled through `caretColor` above and
    // `.cm-cursor` / `.cm-selectionBackground` are never rendered at all
    '.cm-content ::selection': {
      backgroundColor: 'var(--editor-selection-bg)',
    },
    '.cm-specialChar': { color: 'var(--color-error)' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
  }),
  refreshRedrawnSelection,
]

/**
 * Markdown and embedded code highlighting. Colors come from CSS variables, so
 * themes are not duplicated for light and dark modes.
 */
export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--app-syntax-heading)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--app-syntax-link)' },
  { tag: tags.url, color: 'var(--app-syntax-link)' },
  { tag: tags.quote, color: 'var(--app-syntax-quote)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--app-syntax-meta)' },
  { tag: tags.processingInstruction, color: 'var(--app-syntax-meta)' },
  {
    tag: tags.monospace,
    fontFamily: 'var(--font-mono)',
    color: 'var(--app-syntax-code)',
  },
  { tag: tags.keyword, color: 'var(--app-syntax-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--app-syntax-keyword)' },
  { tag: tags.definitionKeyword, color: 'var(--app-syntax-keyword)' },
  { tag: tags.string, color: 'var(--app-syntax-string)' },
  { tag: tags.number, color: 'var(--app-syntax-number)' },
  { tag: tags.bool, color: 'var(--app-syntax-number)' },
  {
    tag: tags.comment,
    color: 'var(--app-syntax-comment)',
    fontStyle: 'italic',
  },
  { tag: tags.function(tags.variableName), color: 'var(--app-syntax-link)' },
  { tag: tags.typeName, color: 'var(--app-syntax-heading)' },
  { tag: tags.propertyName, color: 'var(--app-syntax-code)' },
  { tag: tags.invalid, color: 'var(--color-error)' },
])
