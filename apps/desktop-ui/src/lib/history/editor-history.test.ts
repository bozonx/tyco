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

it('does not record editor history or results when recording is disabled', async () => {
  const call = vi
    .fn<DesktopCall>()
    .mockResolvedValue({ success: true, result: 'saved' })
  let canRecord = false
  const model = createEditorHistoryModel({ call }, () => canRecord)
  expect(await model.saveOutput('Output')).toBeNull()
  expect(await model.saveSource('Source', 'correction')).toBeNull()
  await model.saveSourceResult('existing', 'Result')
  await expect(
    model.restoreEditorItem({
      id: 'existing',
      text: 'Text',
      kind: 'draft',
      createdAt: 1,
    })
  ).rejects.toThrow()
  expect(call).not.toHaveBeenCalled()
  canRecord = true
  expect(await model.saveOutput('Output')).toBe('saved')
  canRecord = false
  await model.saveSourceResult('saved', 'Late result')
  expect(call).toHaveBeenCalledTimes(1)
})

describe('listRecentInstructions', () => {
  it('returns unique trimmed instructions from newest to oldest up to the limit', () => {
    const call = vi.fn<DesktopCall>()
    const model = createEditorHistoryModel({ call })
    model.editorHistory.value = [
      {
        id: '1',
        text: 'Text 1',
        kind: 'source',
        operation: 'aiTask',
        instruction: { text: ' Fix grammar ', inputKind: 'typed' },
        createdAt: 10,
      },
      {
        id: '2',
        text: 'Text 2',
        kind: 'source',
        operation: 'aiTask',
        instruction: { text: 'Fix grammar', inputKind: 'voice' },
        createdAt: 9,
      },
      { id: '3', text: 'Text 3', kind: 'draft', createdAt: 8 },
      {
        id: '4',
        text: 'Text 4',
        kind: 'source',
        operation: 'aiTask',
        instruction: { text: 'Translate to Spanish', inputKind: 'voice' },
        createdAt: 7,
      },
      {
        id: '5',
        text: 'Text 5',
        kind: 'source',
        operation: 'aiTask',
        instruction: { text: 'Make shorter', inputKind: 'typed' },
        createdAt: 6,
      },
      {
        id: '6',
        text: 'Text 6',
        kind: 'source',
        operation: 'aiTask',
        instruction: { text: '   ', inputKind: 'typed' },
        createdAt: 5,
      },
      {
        id: '7',
        text: 'Text 7',
        kind: 'source',
        operation: 'aiTask',
        instruction: { text: 'Simplify', inputKind: 'typed' },
        createdAt: 4,
      },
      {
        id: '8',
        text: 'Text 8',
        kind: 'source',
        operation: 'aiTask',
        instruction: { text: 'Expand', inputKind: 'voice' },
        createdAt: 3,
      },
    ]

    expect(model.listRecentInstructions(3)).toEqual([
      'Fix grammar',
      'Translate to Spanish',
      'Make shorter',
    ])
    expect(model.listRecentInstructions(5)).toEqual([
      'Fix grammar',
      'Translate to Spanish',
      'Make shorter',
      'Simplify',
      'Expand',
    ])
  })

  it('returns empty list when recording is disabled', () => {
    const call = vi.fn<DesktopCall>()
    const model = createEditorHistoryModel({ call }, () => false)
    model.editorHistory.value = [
      {
        id: '1',
        text: 'Text 1',
        kind: 'source',
        operation: 'aiTask',
        instruction: { text: 'Fix grammar', inputKind: 'typed' },
        createdAt: 10,
      },
    ]

    expect(model.listRecentInstructions(5)).toEqual([])
  })
})
