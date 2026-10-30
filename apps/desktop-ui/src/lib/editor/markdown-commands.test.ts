import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import {
  insertLink,
  toggleInlineMark,
  toggleLinePrefix,
  type LinePrefix,
} from './markdown-commands'

const stateWith = (doc: string, from: number, to = from) =>
  EditorState.create({ doc, selection: EditorSelection.range(from, to) })

const apply = (
  state: EditorState,
  spec: ReturnType<typeof toggleInlineMark>
) => {
  const next = state.update(spec).state
  const { from, to } = next.selection.main
  return { doc: next.doc.toString(), selected: next.sliceDoc(from, to), from }
}

describe('toggleInlineMark', () => {
  it('removes code marks around nested emphasis without altering its markers', () => {
    const state = stateWith('`**text**`', 0, 10)
    expect(apply(state, toggleInlineMark(state, '`')).doc).toBe('**text**')
  })
  it('adds and removes italic inside bold without stripping bold', () => {
    const bold = stateWith('**text**', 2, 6)
    const both = bold.update(toggleInlineMark(bold, '*')).state
    expect(both.doc.toString()).toBe('***text***')
    expect(both.update(toggleInlineMark(both, '*')).state.doc.toString()).toBe(
      '**text**'
    )
  })

  it('wraps an entire bold expression in italic instead of unwrapping bold', () => {
    const state = stateWith('**text**', 0, 8)
    expect(apply(state, toggleInlineMark(state, '*')).doc).toBe('***text***')
  })

  it('wraps the selection and keeps it selected', () => {
    const state = stateWith('make it bold', 8, 12)
    expect(apply(state, toggleInlineMark(state, '**'))).toMatchObject({
      doc: 'make it **bold**',
      selected: 'bold',
    })
  })

  it('unwraps marks around or inside the selection', () => {
    const outside = stateWith('**bold**', 2, 6)
    expect(apply(outside, toggleInlineMark(outside, '**')).doc).toBe('bold')

    const inside = stateWith('a *word* b', 2, 8)
    expect(apply(inside, toggleInlineMark(inside, '*'))).toMatchObject({
      doc: 'a word b',
      selected: 'word',
    })
  })

  it('puts the caret between an empty pair', () => {
    const state = stateWith('ab', 1)
    expect(apply(state, toggleInlineMark(state, '`'))).toMatchObject({
      doc: 'a``b',
      from: 2,
    })
  })
})

describe('toggleLinePrefix', () => {
  it('excludes the next line when the selection ends at its start', () => {
    const state = stateWith('one\ntwo', 0, 4)
    expect(
      state.update(toggleLinePrefix(state, '- ')).state.doc.toString()
    ).toBe('- one\ntwo')
  })

  it('formats a collapsed cursor at the start of its own line', () => {
    const state = stateWith('one\ntwo', 4)
    expect(
      state.update(toggleLinePrefix(state, '# ')).state.doc.toString()
    ).toBe('one\n# two')
  })
  it('sets, replaces and removes the prefix of every selected line', () => {
    const plain = stateWith('one\ntwo', 0, 7)
    const listed = plain.update(toggleLinePrefix(plain, '- ')).state
    expect(listed.doc.toString()).toBe('- one\n- two')

    const numbered = listed.update(toggleLinePrefix(listed, '1. ')).state
    expect(numbered.doc.toString()).toBe('1. one\n2. two')

    const back = numbered.update(toggleLinePrefix(numbered, '1. ')).state
    expect(back.doc.toString()).toBe('one\ntwo')
  })

  it('turns a heading into another level', () => {
    const state = stateWith('## Title', 3)
    expect(
      state.update(toggleLinePrefix(state, '# ')).state.doc.toString()
    ).toBe('# Title')
  })
})

describe('toggleLinePrefix with nesting and tasks', () => {
  const toggle = (
    doc: string,
    from: number,
    to: number,
    prefix: LinePrefix
  ) => {
    const state = stateWith(doc, from, to)
    return state.update(toggleLinePrefix(state, prefix)).state.doc.toString()
  }

  it('keeps the indentation of nested items', () => {
    expect(toggle('- a\n  - b', 0, 9, '1. ')).toBe('1. a\n  2. b')
    expect(toggle('  one', 2, 2, '- ')).toBe('  - one')
  })

  it('sets, converts and removes tasks', () => {
    expect(toggle('one\n- two', 0, 9, '- [ ] ')).toBe('- [ ] one\n- [ ] two')
    expect(toggle('- [x] done\n- [ ] todo', 0, 20, '- [ ] ')).toBe('done\ntodo')
    expect(toggle('- [ ] task', 0, 0, '- ')).toBe('- task')
  })
})

describe('insertLink', () => {
  it('leaves the caret where the address goes', () => {
    const state = stateWith('see docs', 4, 8)
    expect(apply(state, insertLink(state))).toMatchObject({
      doc: 'see [docs]()',
      from: 11,
    })
  })

  it('takes a selected address as the address', () => {
    const state = stateWith('https://a.b', 0, 11)
    expect(apply(state, insertLink(state))).toMatchObject({
      doc: '[](https://a.b)',
      from: 1,
    })
  })
})
