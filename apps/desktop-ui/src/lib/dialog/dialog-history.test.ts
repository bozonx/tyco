import type { Dialog } from '@tyco/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDialogHistory,
  type DialogHistorySnapshot,
} from './dialog-history'
import type { DialogSegment } from './dialog-transcript'

const baseInit = {
  id: '2026-11-21_10-00-00_a1b2c3',
  startedAt: 1_000,
  source: 'microphoneAndSystem' as const,
}

function finalSegment(id: string, text: string): DialogSegment {
  return {
    id,
    side: 'me',
    startMs: 0,
    endMs: 1_000,
    text,
    isFinal: true,
    translationState: 'idle',
  }
}

function setup(
  options: {
    isEnabled?: () => boolean
    save?: (dialog: Dialog) => Promise<void>
    onRecordingUnlinked?: () => void
  } = {}
) {
  vi.useFakeTimers()
  let snapshot: DialogHistorySnapshot = {
    title: '',
    translationTargetLanguage: 'en',
    segments: [],
    sessionBreaks: [],
  }
  const saved: Dialog[] = []
  const reportError = vi.fn()
  const history = createDialogHistory({
    isEnabled: options.isEnabled ?? (() => true),
    save:
      options.save ??
      (async (dialog) => {
        saved.push(dialog)
      }),
    getSnapshot: () => snapshot,
    reportError,
    onRecordingUnlinked: options.onRecordingUnlinked,
    now: () => 5_000,
    intervalMs: 15_000,
  })
  return {
    history,
    saved,
    reportError,
    setSegments: (segments: DialogSegment[]) => {
      snapshot = { ...snapshot, segments }
    },
    setSnapshot: (next: Partial<DialogHistorySnapshot>) => {
      snapshot = { ...snapshot, ...next }
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('dialog history', () => {
  it('creates no entry for a session without turns', async () => {
    const { history, saved } = setup()
    await history.begin(baseInit)
    await vi.advanceTimersByTimeAsync(30_000)
    await history.end()
    expect(saved).toEqual([])
  })

  it('checkpoints on the interval only when settled segments changed', async () => {
    const { history, saved, setSegments } = setup()
    await history.begin(baseInit)
    setSegments([
      { ...finalSegment('interim', 'still speaking'), isFinal: false },
    ])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(saved).toHaveLength(0)

    setSegments([finalSegment('1', 'hello')])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      id: baseInit.id,
      startedAt: 1_000,
      source: 'microphoneAndSystem',
      segments: [{ id: '1', text: 'hello' }],
    })

    await vi.advanceTimersByTimeAsync(15_000)
    expect(saved).toHaveLength(1)

    setSegments([finalSegment('1', 'hello'), finalSegment('2', 'hi')])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(saved).toHaveLength(2)
    expect(saved[1].segments).toHaveLength(2)
  })

  it('writes the last turns on end and stops the interval', async () => {
    const { history, saved, setSegments } = setup()
    await history.begin(baseInit)
    setSegments([finalSegment('1', 'bye')])
    await history.end()
    expect(saved).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a failed write and tries again with the next checkpoint', async () => {
    const save = vi
      .fn<(dialog: Dialog) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue()
    const { history, reportError, setSegments } = setup({ save })
    await history.begin(baseInit)
    setSegments([finalSegment('1', 'text')])
    await history.checkpoint()
    expect(reportError).toHaveBeenCalledOnce()
    await history.checkpoint()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('links a recording at once, even before any turn', async () => {
    const recordingFile = '2026-11-21 10-00-00 a1b2c3.opus'
    const { history, saved, setSegments } = setup()
    await history.begin({ ...baseInit, recordingFiles: [recordingFile] })
    expect(saved).toHaveLength(1)
    expect(saved[0].recordingFiles).toEqual([recordingFile])
    expect(saved[0].segments).toEqual([])

    setSegments([finalSegment('1', 'hi')])
    await history.end()
    expect(saved).toHaveLength(2)
    expect(saved[1].segments).toHaveLength(1)
  })

  it('tells once when a recording got no saved dialog', async () => {
    const recordingFile = '2026-11-21 10-00-00 a1b2c3.opus'
    const onRecordingUnlinked = vi.fn()
    const save = vi
      .fn<(dialog: Dialog) => Promise<void>>()
      .mockRejectedValue(new Error('disk'))
    const { history, setSegments } = setup({ save, onRecordingUnlinked })
    await history.begin({ ...baseInit, recordingFiles: [recordingFile] })
    setSegments([finalSegment('1', 'hi')])
    await history.checkpoint()
    expect(onRecordingUnlinked).toHaveBeenCalledTimes(1)
  })

  it('marks a recording as incomplete and persists it', async () => {
    const recordingFile = '2026-11-21 10-00-00 a1b2c3.opus'
    const { history, saved } = setup()
    await history.begin({ ...baseInit, recordingFiles: [recordingFile] })
    await history.markRecordingIncomplete(recordingFile)
    expect(saved.at(-1)?.incompleteRecordingFiles).toEqual([recordingFile])
  })

  it('continues under the same id when a closed or loaded dialog is resumed', async () => {
    const { history, saved, setSegments } = setup()
    await history.begin(baseInit)
    setSegments([finalSegment('1', 'hi')])
    await history.end()
    expect(history.resume()).toBe(true)
    await history.addRecording('2026-11-21 10-05-00 d4e5f6.opus')
    setSegments([finalSegment('1', 'hi'), finalSegment('2', 'hello')])
    await history.end()
    expect(saved.at(-1)).toMatchObject({
      id: baseInit.id,
      recordingFiles: ['2026-11-21 10-05-00 d4e5f6.opus'],
    })
    expect(saved.at(-1)?.segments).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('attaches an existing dialog via load so resuming updates it', async () => {
    const { history, saved, setSegments } = setup()
    const existing: Dialog = {
      id: '2026-11-20_09-00-00_abcdef',
      title: 'Standup',
      startedAt: 100,
      updatedAt: 200,
      source: 'system',
      translationTargetLanguage: 'en',
      segments: [
        {
          id: '1',
          side: 'remote',
          startMs: 0,
          endMs: 500,
          text: 'Old line',
          translationState: 'idle',
        },
      ],
      sessionBreaks: [],
      recordingFiles: ['rec-1.opus'],
      incompleteRecordingFiles: [],
    }
    history.load(existing)
    expect(history.resume()).toBe(true)
    setSegments([finalSegment('1', 'Old line'), finalSegment('2', 'New line')])
    await history.end()
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe(existing.id)
    expect(saved[0].recordingFiles).toEqual(['rec-1.opus'])
  })

  it('appends new recordings to loaded dialog when resumed with a recording', async () => {
    const { history, saved, setSegments } = setup()
    const existing: Dialog = {
      id: '2026-11-20_09-00-00_abcdef',
      title: 'Standup',
      startedAt: 100,
      updatedAt: 200,
      source: 'system',
      translationTargetLanguage: 'en',
      segments: [
        {
          id: '1',
          side: 'remote',
          startMs: 0,
          endMs: 500,
          text: 'Old line',
          translationState: 'idle',
        },
      ],
      sessionBreaks: [],
      recordingFiles: ['rec-1.opus'],
      incompleteRecordingFiles: [],
    }
    history.load(existing)
    expect(history.resume()).toBe(true)
    await history.addRecording('rec-2.opus')
    setSegments([finalSegment('1', 'Old line'), finalSegment('2', 'New line')])
    await history.end()
    expect(saved.at(-1)).toMatchObject({
      id: existing.id,
      recordingFiles: ['rec-1.opus', 'rec-2.opus'],
    })
    expect(saved.at(-1)?.segments).toHaveLength(2)
  })

  it('has nothing to resume after reset or dispose', async () => {
    const { history } = setup()
    expect(history.resume()).toBe(false)
    await history.begin(baseInit)
    await history.end()
    history.reset()
    expect(history.resume()).toBe(false)
  })

  it('leaves no interval behind when a session ends while it begins', async () => {
    const { history } = setup()
    const beginning = history.begin(baseInit)
    const ending = history.end()
    await Promise.all([beginning, ending])
    expect(vi.getTimerCount()).toBe(0)
  })
})
