import { describe, expect, it, vi } from 'vitest'
import type { DesktopCall } from '../ipc/ipc-model'
import { createEditorHistoryModel } from './editor-history'

it('waits for pending writes before reading editor history', async () => {
  let finish!: (value: { success: true; result: string }) => void
  const call = vi
    .fn<DesktopCall>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValueOnce({
      success: true,
      result: [{ id: 'entry', text: 'Draft', kind: 'draft', createdAt: 1 }],
    })
  const model = createEditorHistoryModel({ call: call as DesktopCall })
  const write = model.saveOutput('Draft')
  const read = model.loadEditorHistory()
  await Promise.resolve()
  expect(call).toHaveBeenCalledTimes(1)
  finish({ success: true, result: 'entry' })
  await Promise.all([write, read])
  expect(model.editorHistory.value[0]?.id).toBe('entry')
})

describe('editor history failure semantics', () => {
  it('does not remove an entry when the backend rejects the deletion', async () => {
    const call = vi
      .fn<DesktopCall>()
      .mockResolvedValue({ success: false, error: 'Disk error' })
    const model = createEditorHistoryModel({ call: call as DesktopCall })
    model.editorHistory.value = [
      { id: 'entry', text: 'Draft', kind: 'draft', createdAt: 1 },
    ]
    await expect(model.removeFromEditorHistory('entry')).rejects.toThrow(
      'Disk error'
    )
    expect(model.editorHistory.value).toHaveLength(1)
  })
})
