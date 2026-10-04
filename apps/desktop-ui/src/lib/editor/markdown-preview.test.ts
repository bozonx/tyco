import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { hiddenMarkup } from './markdown-preview'

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
