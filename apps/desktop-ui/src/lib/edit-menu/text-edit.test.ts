import { describe, expect, it, vi } from 'vitest'
import { createTextEditModel, type TextEditSnapshot } from './text-edit'

describe('text edit', () => {
  function setup(snapshot: TextEditSnapshot) {
    const deps = {
      snapshot: () => snapshot,
      replaceSelection: vi.fn(),
      replaceText: vi.fn(),
    }
    return { deps, model: createTextEditModel(deps) }
  }
  it('never falls back to the document for selection-only commands', async () => {
    const { deps, model } = setup({
      text: 'hello',
      selectedText: '',
      from: 0,
      to: 0,
    })
    const action = vi.fn(() => 'changed')
    expect(await model.run({ selectionOnly: true, action })).toBe('empty')
    expect(action).not.toHaveBeenCalled()
    expect(deps.replaceText).not.toHaveBeenCalled()
  })
  it('preserves whitespace in the selected input and replaces only it', async () => {
    const { deps, model } = setup({
      text: 'x a y',
      selectedText: ' a ',
      from: 1,
      to: 4,
    })
    const action = vi.fn((text: string) => text.toUpperCase())
    await model.run({ selectionOnly: true, action })
    expect(action).toHaveBeenCalledWith(' a ')
    expect(deps.replaceSelection).toHaveBeenCalledWith(' A ')
    expect(deps.replaceText).not.toHaveBeenCalled()
  })
  it('keeps text on formatter errors', async () => {
    const { deps, model } = setup({
      text: 'bad',
      selectedText: '',
      from: 0,
      to: 0,
    })
    await expect(
      model.run({
        action: () => {
          throw Error('invalid')
        },
      })
    ).rejects.toThrow('invalid')
    expect(deps.replaceText).not.toHaveBeenCalled()
  })
  it('discards delayed results after the selection changes', async () => {
    const snapshot = { text: 'abc', selectedText: 'a', from: 0, to: 1 }
    const { deps, model } = setup(snapshot)
    let finish!: (text: string) => void
    const running = model.run({
      action: () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    })
    snapshot.to = 2
    finish('changed')
    expect(await running).toBe('stale')
    expect(deps.replaceSelection).not.toHaveBeenCalled()
    expect(deps.replaceText).not.toHaveBeenCalled()
  })
})
