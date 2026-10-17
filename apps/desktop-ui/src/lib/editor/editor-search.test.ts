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

  it('toggles replacement controls and returns to compact search with Ctrl+F', () => {
    mount()
    openEditorSearch(view)
    const replacement = view.dom.querySelector<HTMLElement>(
      '.cm-search-replacement'
    )!
    expect(replacement.hidden).toBe(true)
    expect(view.dom.querySelector('input[name="word"]')).toBeNull()
    const toggle = view.dom.querySelector<HTMLButtonElement>(
      '[name="toggleReplace"]'
    )!
    toggle.click()
    expect(replacement.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const field = view.dom.querySelector<HTMLInputElement>(
      'input[name="search"]'
    )!
    field.value = 'cat'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    expect(getSearchQuery(view.state).search).toBe('cat')
    press('f', 70, { ctrlKey: true })
    expect(replacement.hidden).toBe(true)
    expect(getSearchQuery(view.state).search).toBe('cat')
    for (const name of ['prev', 'next']) {
      const button = view.dom.querySelector<HTMLButtonElement>(
        `button[name="${name}"]`
      )!
      expect(button.title).toBeTruthy()
      expect(button.getAttribute('aria-label')).toBe(button.title)
    }
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

  it('provides case and regexp options in search row and filters matches accordingly', () => {
    view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc: 'Hello hello\nnumber 42' }),
    })
    openEditorSearch(view)
    const row = view.dom.querySelector<HTMLElement>('.cm-search-row')!
    const caseInput = row.querySelector<HTMLInputElement>('input[name="case"]')!
    const regexpInput = row.querySelector<HTMLInputElement>('input[name="re"]')!
    const searchInput = row.querySelector<HTMLInputElement>(
      'input[name="search"]'
    )!
    expect(caseInput).not.toBeNull()
    expect(regexpInput).not.toBeNull()

    // Case insensitive by default
    searchInput.value = 'Hello'
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    findNext(view)
    expect(view.state.selection.main.from).toBe(0)
    findNext(view)
    expect(view.state.selection.main.from).toBe(6)

    // Enable match case
    caseInput.checked = true
    caseInput.dispatchEvent(new Event('change', { bubbles: true }))
    findNext(view)
    expect(view.state.selection.main.from).toBe(0)
    findNext(view)
    // wraps back to 0 because 'hello' at 6 does not match case
    expect(view.state.selection.main.from).toBe(0)

    // Enable regexp
    searchInput.value = '\\d+'
    regexpInput.checked = true
    regexpInput.dispatchEvent(new Event('change', { bubbles: true }))
    findNext(view)
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to
      )
    ).toBe('42')
  })

  it('dispatches scroll effect when navigating matches and replacing one by one', () => {
    mount()
    openEditorReplace(view)
    const searchInput = view.dom.querySelector<HTMLInputElement>(
      'input[name="search"]'
    )!
    const replaceInput = view.dom.querySelector<HTMLInputElement>(
      'input[name="replace"]'
    )!
    searchInput.value = 'cat'
    replaceInput.value = 'dog'
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    replaceInput.dispatchEvent(new Event('input', { bubbles: true }))

    let hadScrollEffect = false
    const origDispatch = view.dispatch.bind(view)
    view.dispatch = ((tr: Parameters<typeof origDispatch>[0]) => {
      const effects = Array.isArray(tr.effects)
        ? tr.effects
        : tr.effects
          ? [tr.effects]
          : []
      if (effects.some((eff) => eff.value && typeof eff.value === 'object')) {
        hadScrollEffect = true
      }
      return origDispatch(tr)
    }) as typeof view.dispatch

    findNext(view)
    expect(hadScrollEffect).toBe(true)

    hadScrollEffect = false
    findPrevious(view)
    expect(hadScrollEffect).toBe(true)

    hadScrollEffect = false
    replaceNext(view)
    expect(hadScrollEffect).toBe(true)
  })

  it('closes search panel when close button is clicked', () => {
    mount()
    openEditorSearch(view)
    expect(searchPanelOpen(view.state)).toBe(true)
    const closeBtn = view.dom.querySelector<HTMLButtonElement>(
      'button[name="close"]'
    )!
    expect(closeBtn).not.toBeNull()
    closeBtn.click()
    expect(searchPanelOpen(view.state)).toBe(false)
  })
})
