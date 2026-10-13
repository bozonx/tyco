import {
  closeSearchPanel,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
  getSearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

/** Every phrase used by the search panel and editor widgets is localized. */
const EDITOR_PHRASE_KEYS: Record<string, string> = {
  Find: 'editor.search.find',
  Replace: 'editor.search.replace',
  next: 'editor.search.next',
  previous: 'editor.search.previous',
  all: 'editor.search.all',
  'match case': 'editor.search.matchCase',
  regexp: 'editor.search.regexp',
  'by word': 'editor.search.wholeWord',
  replace: 'editor.search.replace',
  'replace all': 'editor.search.replaceAll',
  close: 'editor.search.close',
  'current match': 'editor.search.currentMatch',
  'on line': 'editor.search.onLine',
  'replaced match on line $': 'editor.search.replacedOnLine',
  'replaced $ matches': 'editor.search.replacedCount',
  'Copy code': 'chat.copyCode',
  Copied: 'chat.copied',
  'Clipboard is not available': 'editor.menu.clipboardUnavailable',
}

export const editorPhrasesCompartment = new Compartment()
const phrases = (t: (key: string) => string): Extension =>
  EditorState.phrases.of(
    Object.fromEntries(
      Object.entries(EDITOR_PHRASE_KEYS).map(([phrase, key]) => [
        phrase,
        t(key),
      ])
    )
  )

export const openEditorSearch = (view: EditorView): boolean => {
  openSearchPanel(view)
  view.dom
    .querySelector<HTMLInputElement>('.cm-search input[name="search"]')
    ?.focus()
  return true
}

export const openEditorReplace = (view: EditorView): boolean => {
  openEditorSearch(view)
  view.dom
    .querySelector<HTMLInputElement>('.cm-search input[name="replace"]')
    ?.focus()
  return true
}

export const editorSearch = (t: (key: string) => string): Extension => [
  search({ top: true }),
  editorPhrasesCompartment.of(phrases(t)),
  keymap.of([
    { key: 'Mod-h', run: openEditorReplace, scope: 'editor search-panel' },
    ...searchKeymap
      .filter(({ key }) =>
        ['Mod-f', 'Mod-g', 'F3', 'Escape'].includes(key ?? '')
      )
      .map((binding) =>
        binding.key === 'Mod-f'
          ? { ...binding, run: openEditorSearch }
          : binding
      ),
  ]),
  EditorView.theme({
    '.cm-panels': {
      backgroundColor: 'var(--app-surface-raised)',
      color: 'var(--color-base-content)',
    },
    '.cm-panels-top': { borderBottom: '1px solid var(--app-border)' },
    '.cm-search': {
      padding: '0.5rem 1.5rem 0.5rem 0.5rem',
      lineHeight: '2',
      whiteSpace: 'normal',
    },
    '.cm-search .cm-textfield': {
      maxWidth: '100%',
      background: 'var(--app-surface)',
      color: 'var(--color-base-content)',
      border: '1px solid var(--app-border)',
      borderRadius: 'var(--radius-sm)',
    },
    '.cm-search .cm-button': {
      background: 'var(--app-surface)',
      color: 'var(--color-base-content)',
      border: '1px solid var(--app-border)',
      borderRadius: 'var(--radius-sm)',
    },
    // The host models a single selection; selecting every match is not supported.
    '.cm-search button[name="select"]': { display: 'none' },
    '.cm-searchMatch': {
      backgroundColor: 'var(--app-accent-soft)',
      outline: '1px solid var(--app-border)',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'var(--editor-selection-bg)',
    },
  }),
]

/** Recreate an open panel's labels without losing its query or document history. */
export const setEditorPhrases = (
  view: EditorView,
  t: (key: string) => string
): void => {
  const isOpen = searchPanelOpen(view.state)
  const query = getSearchQuery(view.state)
  const active = view.dom.ownerDocument.activeElement as HTMLElement | null
  const field = active?.closest('.cm-search')
    ? active.getAttribute('name')
    : null
  const hadEditorFocus = view.hasFocus
  if (isOpen) closeSearchPanel(view)
  view.dispatch({ effects: editorPhrasesCompartment.reconfigure(phrases(t)) })
  if (isOpen) {
    openEditorSearch(view)
    view.dispatch({ effects: setSearchQuery.of(query) })
    if (field)
      view.dom
        .querySelector<HTMLElement>(`.cm-search [name="${field}"]`)
        ?.focus()
    else if (hadEditorFocus) view.focus()
    else active?.focus()
  }
}
