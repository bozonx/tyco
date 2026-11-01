import { describe, expect, it, vi } from 'vitest'

import { createMemoryEditorModel } from './memory-editor-model'

function setup() {
  const deps = {
    read: vi.fn(async (_id: string, file: string) => file),
    write: vi.fn(async () => {}),
    reportError: vi.fn(),
    onSaved: vi.fn(),
  }
  return { deps, model: createMemoryEditorModel(deps) }
}

describe('memory editor', () => {
  it('keeps the latest file and text together when reads finish out of order', async () => {
    const { deps, model } = setup()
    let finish!: (text: string) => void
    deps.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const first = model.openEditor('profile', 'a.md')
    await model.openEditor('profile', 'b.md')
    finish('Text A')
    await first
    expect(model.editingFile.value).toBe('b.md')
    expect(model.editorContent.value).toBe('b.md')
    await model.saveEditor()
    expect(deps.write).toHaveBeenCalledWith('profile', 'b.md', 'b.md')
    model.dispose()
  })

  it.each(['close', 'dispose'] as const)(
    'ignores a read after %s',
    async (action) => {
      const { deps, model } = setup()
      let finish!: (text: string) => void
      deps.read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      const pending = model.openEditor('profile', 'a.md')
      if (action === 'close') model.closeEditor()
      else model.dispose()
      finish('Late text')
      await pending
      expect(model.isEditorOpen.value).toBe(false)
      expect(model.editorContent.value).toBe('')
      model.dispose()
    }
  )

  it('blocks duplicate saves and preserves edits made during the write', async () => {
    const { deps, model } = setup()
    await model.openEditor('profile', 'a.md')
    let finish!: () => void
    deps.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = model.saveEditor()
    model.editorContent.value = 'New text'
    await model.saveEditor()
    expect(deps.write).toHaveBeenCalledOnce()
    finish()
    await pending
    expect(model.isEditorOpen.value).toBe(true)
    expect(model.editorContent.value).toBe('New text')
    expect(deps.onSaved).toHaveBeenCalledOnce()
    model.dispose()
  })

  it('retains the draft after a failed write', async () => {
    const { deps, model } = setup()
    await model.openEditor('profile', 'a.md')
    deps.write.mockRejectedValueOnce(new Error('Disk full'))
    await model.saveEditor()
    expect(model.isEditorOpen.value).toBe(true)
    expect(deps.reportError).toHaveBeenCalledWith(new Error('Disk full'))
    model.dispose()
  })
})
