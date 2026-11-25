import type { Dialog, DialogSummary } from '@tyco/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDialogHistoryModel } from './dialog-history-model'
import type { DialogStorageDriver } from './dialog-history-storage'

const sampleDialog: Dialog = {
  id: '2026-11-25_10-00-00_a1b2c3',
  title: 'Standup',
  startedAt: 1_000,
  updatedAt: 2_000,
  source: 'microphoneAndSystem',
  translationTargetLanguage: 'en',
  segments: [],
  sessionBreaks: [],
  recordingFiles: ['rec-1.opus'],
  incompleteRecordingFiles: [],
}

const sampleSummary: DialogSummary = {
  id: sampleDialog.id,
  title: sampleDialog.title,
  preview: '',
  startedAt: sampleDialog.startedAt,
  updatedAt: sampleDialog.updatedAt,
  source: sampleDialog.source,
  translationTargetLanguage: sampleDialog.translationTargetLanguage,
  segmentCount: 0,
  recordingCount: 1,
  durationMs: 0,
}

function createStorage(
  overrides: Partial<DialogStorageDriver> = {}
): DialogStorageDriver {
  return {
    listDialogs: vi.fn(async () => [sampleSummary]),
    getDialog: vi.fn(async () => sampleDialog),
    saveDialog: vi.fn(async () => {}),
    renameDialog: vi.fn(async () => {}),
    searchDialogs: vi.fn(async () => [sampleDialog.id]),
    deleteDialog: vi.fn(async () => sampleDialog),
    releaseDialogRecordings: vi.fn(async () => {}),
    clearDialogs: vi.fn(async () => {}),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createDialogHistoryModel', () => {
  it('loads, renames, and searches dialogs', async () => {
    const storage = createStorage()
    const model = createDialogHistoryModel({
      storage,
      isHistoryEnabled: () => true,
      reportError: vi.fn(),
    })

    await model.loadDialogs()
    expect(model.isLoaded.value).toBe(true)
    expect(model.dialogs.value).toEqual([sampleSummary])

    await model.renameDialog(sampleDialog.id, '  Renamed  ')
    expect(storage.renameDialog).toHaveBeenCalledWith(
      sampleDialog.id,
      '  Renamed  '
    )
    expect(model.dialogs.value[0]?.title).toBe('Renamed')

    expect(await model.searchDialogs('Renamed')).toEqual([sampleDialog.id])
  })

  it('defers recording folder release until undo expires and restores on undo', async () => {
    vi.useFakeTimers()
    const storage = createStorage()
    const model = createDialogHistoryModel({
      storage,
      isHistoryEnabled: () => true,
      reportError: vi.fn(),
      timeoutMs: 5_000,
    })

    await model.loadDialogs()
    await model.removeDialog(sampleDialog.id)
    expect(model.dialogs.value).toEqual([])
    expect(model.removedDialog.value).toEqual(sampleDialog)
    expect(storage.releaseDialogRecordings).not.toHaveBeenCalled()

    await model.undoRemoveDialog()
    expect(storage.saveDialog).toHaveBeenCalledWith(sampleDialog)
    expect(storage.releaseDialogRecordings).not.toHaveBeenCalled()
    expect(model.dialogs.value).toEqual([sampleSummary])

    await model.removeDialog(sampleDialog.id)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(storage.releaseDialogRecordings).toHaveBeenCalledWith(
      sampleDialog.id
    )
    model.dispose()
  })

  it('clears dialogs from storage and in-memory state', async () => {
    const storage = createStorage()
    const model = createDialogHistoryModel({
      storage,
      isHistoryEnabled: () => true,
      reportError: vi.fn(),
    })

    await model.loadDialogs()
    await model.clearDialogs()
    expect(storage.clearDialogs).toHaveBeenCalledOnce()
    expect(model.dialogs.value).toEqual([])
  })
})
