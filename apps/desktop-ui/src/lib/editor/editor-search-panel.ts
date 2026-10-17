import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import { type EditorView, type Panel, runScopeHandlers } from '@codemirror/view'

const panels = new WeakMap<
  EditorView,
  { setReplaceMode: (open: boolean) => void }
>()

export const setEditorReplaceMode = (view: EditorView, open: boolean): void => {
  panels.get(view)?.setReplaceMode(open)
}

export const createEditorSearchPanel = (view: EditorView): Panel => {
  const doc = view.dom.ownerDocument
  const dom = doc.createElement('div')
  dom.className = 'cm-search'
  const row = doc.createElement('div')
  row.className = 'cm-search-row'
  const replacement = doc.createElement('div')
  replacement.className = 'cm-search-replacement'
  replacement.hidden = true
  const input = (name: string, phrase: string) => {
    const field = doc.createElement('input')
    field.name = name
    field.className = 'cm-textfield'
    field.placeholder = view.state.phrase(phrase)
    field.setAttribute('aria-label', view.state.phrase(phrase))
    field.addEventListener('input', () => commit())
    return field
  }
  const button = (
    name: string,
    phrase: string,
    action: () => void,
    icon?: string
  ) => {
    const control = doc.createElement('button')
    control.type = 'button'
    control.name = name
    control.className = 'cm-button'
    control.title = view.state.phrase(phrase)
    control.setAttribute('aria-label', control.title)
    control.textContent = icon ?? control.title
    control.addEventListener('click', action)
    return control
  }
  const searchField = input('search', 'Find')
  searchField.setAttribute('main-field', 'true')
  const replaceField = input('replace', 'Replace')
  const checkbox = (name: string, phrase: string) => {
    const label = doc.createElement('label')
    const field = doc.createElement('input')
    field.type = 'checkbox'
    field.name = name
    field.addEventListener('change', () => commit())
    label.append(field, view.state.phrase(phrase))
    return { field, label }
  }
  const toggle = button('toggleReplace', 'Replace', () => {
    setReplaceMode(replacement.hidden === true)
    if (!replacement.hidden) replaceField.focus()
  })
  toggle.className = 'cm-search-toggle'
  const setReplaceMode = (open: boolean) => {
    replacement.hidden = !open || view.state.readOnly
    toggle.setAttribute('aria-expanded', String(!replacement.hidden))
  }
  setReplaceMode(false)
  panels.set(view, { setReplaceMode })
  const caseItem = checkbox('case', 'match case')
  const regexpItem = checkbox('re', 'regexp')
  const caseField = caseItem.field
  const regexpField = regexpItem.field
  row.append(
    searchField,
    button(
      'prev',
      'previous',
      () => {
        findPrevious(view)
      },
      '↑'
    ),
    button(
      'next',
      'next',
      () => {
        findNext(view)
      },
      '↓'
    ),
    caseItem.label,
    regexpItem.label
  )
  if (!view.state.readOnly) row.append(toggle)
  const closeButton = button(
    'close',
    'close',
    () => {
      closeSearchPanel(view)
    },
    '✕'
  )
  replacement.append(
    replaceField,
    button('replace', 'replace', () => {
      replaceNext(view)
    }),
    button('replaceAll', 'replace all', () => {
      replaceAll(view)
    })
  )
  const commit = () => {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: searchField.value,
          replace: replaceField.value,
          caseSensitive: caseField.checked,
          regexp: regexpField.checked,
        })
      ),
    })
  }
  const sync = () => {
    const query = getSearchQuery(view.state)
    searchField.value = query.search
    replaceField.value = query.replace
    caseField.checked = query.caseSensitive
    regexpField.checked = query.regexp
    searchField.setAttribute(
      'aria-invalid',
      String(!query.valid && !!query.search)
    )
  }
  sync()
  dom.append(row, replacement, closeButton)
  dom.addEventListener('keydown', (event) => {
    if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault()
    else if (event.key === 'Enter') {
      event.preventDefault()
      if (event.target === replaceField) replaceNext(view)
      else (event.shiftKey ? findPrevious : findNext)(view)
    }
  })
  return {
    dom,
    top: true,
    update: sync,
    mount: () => searchField.select(),
    destroy: () => {
      panels.delete(view)
    },
  }
}
