import { describe, expect, it, vi } from 'vitest'
import { proxyRefs } from 'vue'
import { createEditorInputModel } from '../editor-input/editor-input-model'
import { createTextEditModel, transformTextCase } from './text-edit'

function setup(value: string, selectedText = '', from = 0, to = 0) {
  const editor = proxyRefs(createEditorInputModel())
  editor.setValue(value)
  editor.setSelection(selectedText, from, to)
  const model = createTextEditModel({
    snapshot: editor.getSnapshot,
    applyEdit: editor.applySnapshotEdit,
  })
  return { editor, model }
}

describe('text edit', () => {
  it('never falls back to the document for selection-only commands', async () => {
    const { editor, model } = setup('hello')
    const action = vi.fn(() => 'changed')
    expect(await model.run({ selectionOnly: true, action })).toBe('empty')
    expect(action).not.toHaveBeenCalled()
    expect(editor.value).toBe('hello')
  })
  it('preserves whitespace and replaces only the selection', async () => {
    const { editor, model } = setup('x a y', ' a ', 1, 4)
    expect(await model.run({ action: (text) => text.toUpperCase() })).toBe(
      'applied'
    )
    expect(editor.value).toBe('x A y')
  })
  it('keeps text on formatter errors and invalid results', async () => {
    const { editor, model } = setup('bad')
    await expect(
      model.run({
        action: () => {
          throw new Error('invalid')
        },
      })
    ).rejects.toThrow('invalid')
    await expect(model.run({ action: () => null as never })).rejects.toThrow(
      'Invalid text transform result'
    )
    expect(editor.value).toBe('bad')
  })
  it.each(['selection', 'document', 'undo'])(
    'discards delayed results after %s changes',
    async (change) => {
      const { editor, model } = setup('abc', 'a', 0, 1)
      let finish!: (text: string) => void
      const pending = model.run({
        action: () =>
          new Promise<string>((resolve) => {
            finish = resolve
          }),
      })
      if (change === 'selection') editor.setSelection('ab', 0, 2)
      else {
        editor.setValue('new')
        if (change === 'undo') editor.setValue('abc')
      }
      const before = editor.getSnapshot()
      finish('changed')
      expect(await pending).toBe('stale')
      expect(editor.getSnapshot()).toEqual(before)
    }
  )
})

describe('transformTextCase', () => {
  it.each([
    ['uppercase', 'HELLO WORLD'],
    ['lowercase', 'hello world'],
  ])('dispatches %s to the real implementation', (type, expected) => {
    expect(transformTextCase('hello world', type)).toBe(expected)
  })

  it('preserves whitespace for upper and lower case', () => {
    expect(transformTextCase(' Hello\nWorld ', 'uppercase')).toBe(
      ' HELLO\nWORLD '
    )
    expect(transformTextCase(' Hello\nWorld ', 'lowercase')).toBe(
      ' hello\nworld '
    )
  })

  it('preserves input for unknown transforms', () => {
    expect(transformTextCase('helloWorld', 'unknown')).toBe('helloWorld')
  })
})
