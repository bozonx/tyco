import { undo } from '@codemirror/commands'
import {
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { translate, setI18nLocale } from '../i18n'
import { createEditorState } from './create-editor-state'
import {
  openEditorReplace,
  openEditorSearch,
  setEditorPhrases,
} from './editor-search'

let view: EditorView
const mount = () => {
  view = new EditorView({
    parent: document.body,
    state: createEditorState({
      doc: 'cat Cat cat\nscatter',
      markdownPreview: true,
    }),
  })
  view.focus()
}
const press = (key: string, keyCode: number, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key === 'Escape' ? key : undefined,
    keyCode,
    bubbles: true,
    cancelable: true,
    ...extra,
  })
  Object.defineProperty(event, 'keyCode', { value: keyCode })
  ;(document.activeElement ?? view.contentDOM).dispatchEvent(event)
  return event
}
afterEach(() => {
  view?.destroy()
  setI18nLocale('en_US')
})

describe('editor search and replace', () => {
  it('reveals a match in hidden Markdown while the search panel has focus', () => {
    view = new EditorView({
      parent: document.body,
      state: createEditorState({
        doc: '[label](https://example.com)',
        markdownPreview: true,
      }),
    })
    expect(view.contentDOM.textContent).not.toContain('https://example.com')
    openEditorSearch(view)
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: 'https://example.com' })
      ),
    })
    findNext(view)
    expect(view.hasFocus).toBe(false)
    expect(view.contentDOM.textContent).toContain('https://example.com')
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to
      )
    ).toBe('https://example.com')
  })
  it('opens search with Ctrl+F and focuses replacement with Ctrl+H', () => {
    mount()
    expect(press('f', 70, { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(searchPanelOpen(view.state)).toBe(true)
    expect(document.activeElement?.getAttribute('name')).toBe('search')
    expect(press('h', 72, { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement?.getAttribute('name')).toBe('replace')
    expect(press('Escape', 27).defaultPrevented).toBe(true)
    expect(searchPanelOpen(view.state)).toBe(false)
  })

  it('navigates matches forward and backward across the document', () => {
    mount()
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: 'cat', wholeWord: true })
      ),
    })
    findNext(view)
    expect(view.state.selection.main.from).toBe(0)
    findNext(view)
    expect(view.state.selection.main.from).toBe(4)
    findPrevious(view)
    expect(view.state.selection.main.from).toBe(0)
  })

  it('replaces all exact words in one undo step and synchronizes editor callbacks', () => {
    let text = ''
    view = new EditorView({
      parent: document.body,
      state: createEditorState({
        doc: 'cat Cat cat\nscatter',
        onDocChange: (value) => {
          text = value
        },
      }),
    })
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: 'cat',
          replace: 'dog',
          wholeWord: true,
          caseSensitive: true,
        })
      ),
    })
    expect(replaceAll(view)).toBe(true)
    expect(text).toBe('dog Cat dog\nscatter')
    undo(view)
    expect(text).toBe('cat Cat cat\nscatter')
  })

  it('supports regex captures and replacement of the selected match', () => {
    mount()
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: '(c)(at)',
          replace: '$2$1',
          regexp: true,
          caseSensitive: true,
          wholeWord: true,
        })
      ),
    })
    findNext(view)
    replaceNext(view)
    expect(view.state.doc.toString()).toBe('atc Cat cat\nscatter')
  })

  it('does not alter the document for an invalid regex', () => {
    mount()
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: '[', replace: 'oops', regexp: true })
      ),
    })
    replaceAll(view)
    expect(view.state.doc.toString()).toBe('cat Cat cat\nscatter')
  })

  it.each(['en_US', 'ru_RU', 'es_AR', 'tr_TR'] as const)(
    'localizes the panel in %s and preserves its query when language changes',
    (locale) => {
      mount()
      openEditorReplace(view)
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({
            search: 'cat',
            replace: 'dog',
            caseSensitive: true,
          })
        ),
      })
      setI18nLocale(locale)
      setEditorPhrases(view, translate)
      expect(
        view.dom
          .querySelector('input[name="search"]')
          ?.getAttribute('aria-label')
      ).toBe(translate('editor.search.find'))
      expect(
        view.dom
          .querySelector('input[name="replace"]')
          ?.getAttribute('aria-label')
      ).toBe(translate('editor.search.replace'))
      expect(getSearchQuery(view.state).search).toBe('cat')
      expect(getSearchQuery(view.state).replace).toBe('dog')
      expect(document.activeElement?.getAttribute('name')).toBe('replace')
    }
  )

  it('keeps syntax highlighting in source mode and after switching modes', async () => {
    const { setMarkdownPreview } = await import('./markdown-preview')
    view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc: '**bold**', markdownPreview: false }),
    })
    expect(view.contentDOM.querySelector('span')).not.toBeNull()
    setMarkdownPreview(view, true)
    setMarkdownPreview(view, false)
    expect(view.contentDOM.querySelector('span')).not.toBeNull()
    expect(view.state.doc.toString()).toBe('**bold**')
  })
})
