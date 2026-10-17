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

import {
  createEditorSearchPanel,
  setEditorReplaceMode,
} from './editor-search-panel'

/** Every phrase used by the search panel and editor widgets is localized. */
const EDITOR_PHRASE_KEYS: Record<string, string> = {
  Find: 'editor.search.find',
  Replace: 'editor.search.replace',
  next: 'editor.search.next',
  previous: 'editor.search.previous',
  all: 'editor.search.all',
  'match case': 'editor.search.matchCase',
  regexp: 'editor.search.regexp',
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

const editorPhrasesCompartment = new Compartment()
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
  setEditorReplaceMode(view, false)
  view.dom
    .querySelector<HTMLInputElement>('.cm-search input[name="search"]')
    ?.focus()
  return true
}

export const openEditorReplace = (view: EditorView): boolean => {
  openEditorSearch(view)
  setEditorReplaceMode(view, true)
  view.dom
    .querySelector<HTMLInputElement>('.cm-search input[name="replace"]')
    ?.focus()
  return true
}

export const editorSearch = (t: (key: string) => string): Extension => [
  search({
    top: true,
    createPanel: createEditorSearchPanel,
    scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: 'center' }),
  }),
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
      position: 'relative',
      padding: '0.5rem 2.5rem 0.5rem 0.75rem',
      fontSize: 'var(--text-control)',
      fontFamily: 'var(--font-sans)',
      lineHeight: '1.5',
      whiteSpace: 'normal',
      boxSizing: 'border-box',
    },
    '.cm-search-row, .cm-search-replacement': {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      flexWrap: 'wrap',
    },
    '.cm-search-replacement': { marginTop: '0.5rem' },
    '.cm-search-replacement[hidden]': { display: 'none' },
    '.cm-search input[name=search]': { flex: '1', minWidth: '8rem' },
    '.cm-search input[name=replace]': { flex: '1', minWidth: '10rem' },
    '.cm-search label': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.375rem',
      fontSize: 'var(--text-control)',
      color: 'var(--color-base-content)',
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      margin: '0',
    },
    '.cm-search input[type=checkbox]': {
      margin: '0',
      cursor: 'pointer',
      accentColor: 'var(--color-primary)',
      width: '0.9375rem',
      height: '0.9375rem',
    },
    '.cm-search .cm-search-toggle': {
      height: 'var(--control-size-sm)',
      boxSizing: 'border-box',
      fontSize: 'var(--text-control)',
      fontWeight: '500',
      fontFamily: 'inherit',
      padding: '0.25rem 0.625rem',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      color: 'var(--color-primary)',
      border: '1px solid transparent',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      transition:
        'background-color var(--transition-fast), border-color var(--transition-fast)',
    },
    '.cm-search .cm-search-toggle:hover': {
      backgroundColor: 'var(--app-accent-soft)',
    },
    '.cm-search .cm-search-toggle[aria-expanded="true"]': {
      backgroundColor: 'var(--app-accent-soft)',
      borderColor: 'color-mix(in oklab, var(--color-primary) 30%, transparent)',
    },
    '.cm-search .cm-search-toggle:focus-visible': {
      boxShadow: 'var(--app-focus-ring)',
      outline: 'none',
    },
    '.cm-search button[name=close]': {
      position: 'absolute',
      top: '0.5rem',
      right: '0.5rem',
      width: '1.75rem',
      height: '1.75rem',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
      border: '1px solid transparent',
      borderRadius: 'var(--radius-sm)',
      background: 'transparent',
      color: 'var(--app-text-muted)',
      cursor: 'pointer',
      fontSize: '1rem',
      lineHeight: '1',
      transition:
        'background-color var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)',
    },
    '.cm-search button[name=close]:hover': {
      backgroundColor: 'var(--app-hover)',
      color: 'var(--color-base-content)',
    },
    '.cm-search button[name=close]:active': {
      backgroundColor: 'var(--app-active)',
    },
    '.cm-search button[name=close]:focus-visible': {
      boxShadow: 'var(--app-focus-ring)',
      borderColor: 'var(--color-primary)',
      outline: 'none',
    },
    '.cm-search .cm-textfield': {
      height: 'var(--control-size-sm)',
      boxSizing: 'border-box',
      fontSize: 'var(--text-control)',
      fontFamily: 'inherit',
      lineHeight: '1.25rem',
      padding: '0.25rem 0.625rem',
      maxWidth: '100%',
      background: 'var(--app-surface)',
      color: 'var(--color-base-content)',
      border: '1px solid var(--app-border)',
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      transition:
        'border-color var(--transition-fast), box-shadow var(--transition-fast)',
    },
    '.cm-search .cm-textfield:hover': {
      borderColor: 'var(--app-border-strong)',
    },
    '.cm-search .cm-textfield:focus': {
      borderColor: 'var(--color-primary)',
      boxShadow: 'var(--app-focus-ring)',
    },
    '.cm-search .cm-textfield[aria-invalid="true"]': {
      borderColor: 'var(--color-error)',
      boxShadow: '0 0 0 1px var(--color-error)',
    },
    '.cm-search .cm-button': {
      height: 'var(--control-size-sm)',
      boxSizing: 'border-box',
      fontSize: 'var(--text-control)',
      fontWeight: '500',
      fontFamily: 'inherit',
      padding: '0.25rem 0.625rem',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      whiteSpace: 'nowrap',
      background: 'var(--app-surface)',
      color: 'var(--color-base-content)',
      border: '1px solid var(--app-border)',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      boxShadow: 'var(--app-shadow-sm)',
      transition:
        'background-color var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast)',
    },
    '.cm-search .cm-button:hover': {
      backgroundColor:
        'color-mix(in oklab, var(--color-base-content) 5%, var(--app-surface))',
      borderColor: 'var(--app-border-strong)',
    },
    '.cm-search .cm-button:active': {
      backgroundColor:
        'color-mix(in oklab, var(--color-base-content) 10%, var(--app-surface))',
    },
    '.cm-search .cm-button:focus-visible': {
      boxShadow: 'var(--app-focus-ring)',
      borderColor: 'var(--color-primary)',
      outline: 'none',
    },
    '.cm-search button[name=prev], .cm-search button[name=next]': {
      width: 'var(--control-size-sm)',
      minWidth: 'var(--control-size-sm)',
      padding: '0',
      fontSize: '0.9375rem',
    },
    // The host models a single selection; selecting every match is not supported.
    '.cm-search button[name="select"]': { display: 'none' },
    '.cm-searchMatch': {
      backgroundColor: '#facc15',
      color: '#1c1917',
      outline: '1px solid #eab308',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: '#fb923c',
      color: '#1c1917',
      outline: '2px solid #f97316',
    },
  }),
]

/** Recreate an open panel's labels without losing its query or document history. */
export const setEditorPhrases = (
  view: EditorView,
  t: (key: string) => string
): void => {
  const isOpen = searchPanelOpen(view.state)
  const replaceMode =
    view.dom.querySelector('.cm-search-replacement')?.hasAttribute('hidden') ===
    false
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
    setEditorReplaceMode(view, replaceMode)
    view.dispatch({ effects: setSearchQuery.of(query) })
    if (field)
      view.dom
        .querySelector<HTMLElement>(`.cm-search [name="${field}"]`)
        ?.focus()
    else if (hadEditorFocus) view.focus()
    else active?.focus()
  }
}
