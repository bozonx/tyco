import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'

import {
  hiddenMarkup,
  previewDecorations,
  setMarkdownPreview,
} from './markdown-preview'
import { createEditorState } from './create-editor-state'
import { MarkerWidget, PreviewWidget } from './preview-widget'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'

const hiddenText = (doc: string, caret: number): string[] => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return hiddenMarkup(state).map(({ from, to }) => doc.slice(from, to))
}

describe('hiddenMarkup', () => {
  const doc =
    'caret here\n# Title\nSome **bold**, `code` and [link](https://a.b)'

  it('hides the markup of the lines the caret is not on', () => {
    expect(hiddenText(doc, 0)).toEqual([
      '# ',
      '**',
      '**',
      '`',
      '`',
      '[',
      '](https://a.b)',
    ])
  })

  it('keeps the markup of the line being edited', () => {
    expect(hiddenText(doc, doc.length)).toEqual(['# '])
  })

  it('leaves code fences, references and autolinks alone', () => {
    expect(
      hiddenText(
        'x\n```\ncode\n```\n[ref][1] <https://a.b>\n\n[1]: https://a.b',
        0
      )
    ).toEqual([])
  })
})

const formattedRanges = (doc: string, focused = false, caret = 0) => {
  const state = createEditorState({ doc, markdownPreview: true })
  ensureSyntaxTree(state, doc.length, 5000)
  const selected = state.update({
    selection: EditorSelection.cursor(caret),
  }).state
  const ranges: Array<{
    from: number
    to: number
    spec: Record<string, unknown>
  }> = []
  previewDecorations(selected, focused).between(
    0,
    doc.length,
    (from, to, decoration) => {
      ranges.push({ from, to, spec: decoration.spec })
    }
  )
  return ranges
}

describe('live preview', () => {
  it('formats all heading levels and collapses setext underlines', () => {
    const doc =
      '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\nSetext\n======\n'
    const ranges = formattedRanges(doc)
    for (let level = 1; level <= 6; level++) {
      expect(
        ranges.some(({ spec }) =>
          String(spec.class).includes(`cm-preview-h${level}`)
        )
      ).toBe(true)
    }
    expect(
      ranges
        .filter(({ spec }) => spec.previewAtomic)
        .map(({ from, to }) => doc.slice(from, to))
    ).toContain('\n======')
  })

  it('renders tasks, list markers, quotes, rules and tables with native decorations', () => {
    const doc =
      '- item\n- [x] done\n> quote\n\n---\n\n| A | B |\n| --- | --- |\n| one | two |'
    const ranges = formattedRanges(doc)
    const widgets = ranges.map(({ spec }) => spec.widget).filter(Boolean)
    expect(
      widgets.some(
        (widget) => widget instanceof MarkerWidget && widget.text === '•'
      )
    ).toBe(true)
    expect(
      widgets.some(
        (widget) => widget instanceof MarkerWidget && widget.checked === true
      )
    ).toBe(true)
    expect(
      widgets.some(
        (widget) => widget instanceof PreviewWidget && widget.kind === 'rule'
      )
    ).toBe(true)
    expect(
      widgets.some(
        (widget) => widget instanceof PreviewWidget && widget.kind === 'table'
      )
    ).toBe(true)
    expect(ranges.some(({ spec }) => spec.class === 'cm-preview-quote')).toBe(
      true
    )
  })

  it('reveals the whole table or code block when a selection touches it', () => {
    const table = '| A | B |\n| --- | --- |\n| one | two |'
    expect(
      formattedRanges(table, true, table.length).some(
        ({ spec }) => spec.widget instanceof PreviewWidget
      )
    ).toBe(false)
    const code = '```ts\nconst value = 1\n```'
    expect(
      formattedRanges(code, false).filter(({ spec }) => spec.previewAtomic)
    ).toHaveLength(2)
    expect(
      formattedRanges(code, true, 12).filter(({ spec }) => spec.previewAtomic)
    ).toHaveLength(0)
  })

  it('keeps code examples literal and handles an empty fenced block', () => {
    const doc = '```\n# heading **literal**\n```\n\n```\n```'
    const hidden = formattedRanges(doc)
      .filter(({ spec }) => spec.previewAtomic)
      .map(({ from, to }) => doc.slice(from, to))
    expect(hidden).toEqual(['```\n', '\n```'])
  })

  it('reveals source on active lines only while focused', () => {
    const doc = '# Title\n**bold**'
    expect(
      formattedRanges(doc, true)
        .filter(({ spec }) => spec.previewAtomic)
        .map(({ from, to }) => doc.slice(from, to))
    ).toEqual(['**', '**'])
    expect(
      formattedRanges(doc, false)
        .filter(({ spec }) => spec.previewAtomic)
        .map(({ from, to }) => doc.slice(from, to))
    ).toEqual(['# ', '**', '**'])
  })

  it('preserves the Markdown, selection and undo history when switching modes', () => {
    const view = new EditorView({
      parent: document.body,
      state: createEditorState({
        doc: '# Title\n**bold**',
        markdownPreview: true,
      }),
    })
    try {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '!' },
        selection: { anchor: 3 },
        userEvent: 'input.type',
      })
      const selection = view.state.selection
      const source = view.state.doc.toString()
      setMarkdownPreview(view, false)
      expect(view.state.doc.toString()).toBe(source)
      expect(view.state.selection.eq(selection)).toBe(true)
      expect(getComputedStyle(view.scrollDOM).fontFamily).toBe(
        'var(--font-mono)'
      )
      expect(view.dom.querySelector('.cm-preview-heading')).toBeNull()
      expect(view.contentDOM.textContent).toContain('# Title')
      expect(view.contentDOM.querySelector('span')).toBeNull()
      setMarkdownPreview(view, true)
      expect(view.dom.querySelector('.cm-preview-heading')).not.toBeNull()
      expect(undo(view)).toBe(true)
      expect(view.state.doc.toString()).toBe('# Title\n**bold**')
    } finally {
      view.destroy()
    }
  })

  it('reveals markup on focus, restores preview on blur, and keeps active source when switching', async () => {
    const view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc: '# Title', markdownPreview: true }),
    })
    try {
      expect(view.contentDOM.textContent).toBe('Title')
      view.focus()
      await vi.waitFor(() =>
        expect(view.contentDOM.textContent).toBe('# Title')
      )
      setMarkdownPreview(view, false)
      setMarkdownPreview(view, true)
      expect(view.contentDOM.textContent).toBe('# Title')
      view.contentDOM.blur()
      await vi.waitFor(() => expect(view.contentDOM.textContent).toBe('Title'))
    } finally {
      view.destroy()
    }
  })

  it('updates task Markdown through a checkbox transaction that can be undone', () => {
    const view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc: '- [ ] task', markdownPreview: true }),
    })
    try {
      const checkbox = view.dom.querySelector<HTMLInputElement>(
        'input[type=checkbox]'
      )!
      expect(checkbox).not.toBeNull()
      checkbox.checked = true
      checkbox.dispatchEvent(new Event('change'))
      expect(view.state.doc.toString()).toBe('- [x] task')
      undo(view)
      expect(view.state.doc.toString()).toBe('- [ ] task')
    } finally {
      view.destroy()
    }
  })

  it('renders nested blocks without overlapping replacement ranges', () => {
    const doc =
      '> Heading\n> =======\n>\n> ```ts\n> const value = 1\n> ```\n>\n> | A | B |\n> | --- | --- |\n> | one | two |'
    const ranges = formattedRanges(doc).filter(({ spec }) => spec.previewAtomic)
    for (let index = 1; index < ranges.length; index++) {
      expect(ranges[index]!.from).toBeGreaterThanOrEqual(ranges[index - 1]!.to)
    }
    const view = new EditorView({
      parent: document.body,
      state: createEditorState({ doc, markdownPreview: true }),
    })
    try {
      expect(view.dom.querySelector('table')).not.toBeNull()
      expect(view.dom.querySelector('th')?.textContent).toBe('A')
    } finally {
      view.destroy()
    }
  })

  it('renders table content safely and avoids remote image requests', () => {
    const view = new EditorView({
      parent: document.body,
      state: createEditorState(),
    })
    try {
      const table = new PreviewWidget(
        '| A |\n| --- |\n| **bold** |',
        0,
        'table'
      ).toDOM(view)
      expect(table.querySelector('th')?.textContent).toBe('A')
      expect(table.querySelector('strong')?.textContent).toBe('bold')
      const image = new PreviewWidget(
        '![Photo](https://example.com/photo.png)',
        0,
        'image'
      ).toDOM(view)
      expect(image.querySelector('img')).toBeNull()
      expect(image.textContent).toBe('Photo')
      const unsafe = new PreviewWidget(
        '| A |\n| --- |\n| <script>alert(1)</script> |',
        0,
        'table'
      ).toDOM(view)
      expect(unsafe.querySelector('script')).toBeNull()
    } finally {
      view.destroy()
    }
  })
})
