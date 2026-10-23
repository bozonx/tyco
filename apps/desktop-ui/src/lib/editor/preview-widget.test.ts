import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEditorState } from './create-editor-state'
import { setI18nLocale, translate } from '../i18n'

let view: EditorView
const mount = () => {
  view = new EditorView({
    parent: document.body,
    state: createEditorState({
      doc: '```ts\nconst value = 1\n```',
      markdownPreview: true,
    }),
  })
  return view.dom.querySelector<HTMLButtonElement>('.cm-preview-code-copy')!
}
afterEach(() => {
  view?.destroy()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setI18nLocale('en-US')
})

describe('code block clipboard feedback', () => {
  it.each(['en-US', 'ru-RU', 'es-AR', 'tr-TR'] as const)(
    'localizes the copy button in %s',
    (locale) => {
      setI18nLocale(locale)
      const button = mount()
      expect(button.title).toBe(translate('chat.copyCode'))
      expect(button.getAttribute('aria-label')).toBe(translate('chat.copyCode'))
    }
  )

  it.each(['missing', 'denied'] as const)(
    'reports clipboard %s without displaying success',
    async (kind) => {
      vi.stubGlobal(
        'navigator',
        kind === 'missing'
          ? {}
          : {
              clipboard: {
                writeText: vi.fn().mockRejectedValue(new Error('denied')),
              },
            }
      )
      const button = mount()
      button.click()
      await Promise.resolve()
      await Promise.resolve()
      expect(button.classList.contains('copied')).toBe(false)
      expect(view.dom.querySelector('[role="status"]')?.textContent).toBe(
        translate('editor.menu.clipboardUnavailable')
      )
    }
  )

  it('announces success only after writing and clears temporary feedback', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const button = mount()
    button.click()
    expect(button.classList.contains('copied')).toBe(false)
    finish()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith('const value = 1')
    expect(button.classList.contains('copied')).toBe(true)
    expect(view.dom.querySelector('[role="status"]')?.textContent).toBe(
      translate('common.copied')
    )
    vi.advanceTimersByTime(1500)
    expect(button.classList.contains('copied')).toBe(false)
    expect(view.dom.querySelector('[role="status"]')?.textContent).toBe('')
  })
})
