import type { EditorHistoryEntry } from '@tyco/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDialogHistory } from './dialog-history'

const meta = { startedAt: 1_000, source: 'microphoneAndSystem' as const }

function setup(
  options: {
    save?: (entry: EditorHistoryEntry) => Promise<string | null>
    onRecordingUnlinked?: () => void
  } = {}
) {
  vi.useFakeTimers()
  let text = ''
  const saved: EditorHistoryEntry[] = []
  const reportError = vi.fn()
  const history = createDialogHistory({
    save:
      options.save ??
      (async (entry) => {
        saved.push(entry)
        return entry.id ?? `entry-${saved.length}`
      }),
    getText: () => text,
    reportError,
    onRecordingUnlinked: options.onRecordingUnlinked,
    intervalMs: 15_000,
  })
  return {
    history,
    saved,
    reportError,
    setText: (next: string) => {
      text = next
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('dialog history', () => {
  it('creates no entry for a session without turns', async () => {
    const { history, saved } = setup()
    await history.begin(meta)
    await vi.advanceTimersByTimeAsync(30_000)
    await history.end()
    expect(saved).toEqual([])
  })

  it('checkpoints on the interval only when the text changed', async () => {
    const { history, saved, setText } = setup()
    await history.begin(meta)
    setText('Me: hello')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(saved).toEqual([{ text: 'Me: hello', kind: 'dialog', dialog: meta }])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(saved).toHaveLength(1)
    setText('Me: hello\nOther side: hi')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(saved[1]).toMatchObject({
      id: 'entry-1',
      text: 'Me: hello\nOther side: hi',
    })
  })

  it('writes the last turns on end and stops the interval', async () => {
    const { history, saved, setText } = setup()
    await history.begin(meta)
    setText('Me: bye')
    await history.end()
    expect(saved).toEqual([{ text: 'Me: bye', kind: 'dialog', dialog: meta }])
    expect(vi.getTimerCount()).toBe(0)
    setText('Me: bye again')
    await history.checkpoint()
    expect(saved).toHaveLength(1)
  })

  it('opens a new entry per session', async () => {
    const { history, saved, setText } = setup()
    await history.begin(meta)
    setText('first')
    await history.checkpoint()
    await history.end()
    setText('')
    await history.begin({ ...meta, startedAt: 2_000 })
    setText('second')
    await history.checkpoint()
    expect(saved.map((entry) => entry.id)).toEqual([undefined, undefined])
    expect(saved[1].dialog?.startedAt).toBe(2_000)
  })

  it('keeps trying a deleted entry, so that its undo gets the later turns', async () => {
    let isDeleted = false
    const saved: EditorHistoryEntry[] = []
    const save = vi.fn(async (entry: EditorHistoryEntry) => {
      if (entry.id && isDeleted) return null
      saved.push(entry)
      return 'entry'
    })
    const { history, setText } = setup({ save })
    await history.begin(meta)
    setText('one')
    await history.checkpoint()
    isDeleted = true
    setText('two')
    await history.checkpoint()
    await history.checkpoint()
    expect(saved.map((entry) => entry.text)).toEqual(['one'])
    // the undo brought the entry back
    isDeleted = false
    await history.checkpoint()
    expect(saved.map((entry) => entry.text)).toEqual(['one', 'two'])
  })

  it('reports a failed write and tries again with the next checkpoint', async () => {
    const save = vi
      .fn<(entry: EditorHistoryEntry) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue('entry')
    const { history, reportError, setText } = setup({ save })
    await history.begin(meta)
    setText('text')
    await history.checkpoint()
    expect(reportError).toHaveBeenCalledOnce()
    await history.checkpoint()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('links a recording at once, even before any turn', async () => {
    const recorded = {
      ...meta,
      recordingFile: '2026-11-21 10-00-00 a1b2c3.opus',
    }
    const { history, saved, setText } = setup()
    await history.begin(recorded)
    expect(saved).toEqual([{ text: '', kind: 'dialog', dialog: recorded }])
    await history.end()
    expect(saved).toHaveLength(1)
    setText('')
    await history.begin(recorded)
    setText('Me: hi')
    await history.end()
    expect(saved.at(-1)).toMatchObject({ id: 'entry-2', text: 'Me: hi' })
  })

  it('tells once when a recording got no entry', async () => {
    const recorded = {
      ...meta,
      recordingFile: '2026-11-21 10-00-00 a1b2c3.opus',
    }
    const onRecordingUnlinked = vi.fn()
    const save = vi
      .fn<(entry: EditorHistoryEntry) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue(null)
    const { history, setText } = setup({ save, onRecordingUnlinked })
    await history.begin(recorded)
    setText('Me: hi')
    await history.checkpoint()
    expect(onRecordingUnlinked).toHaveBeenCalledTimes(1)
  })

  it('stays quiet once the recording has its entry', async () => {
    const onRecordingUnlinked = vi.fn()
    const { history } = setup({ onRecordingUnlinked })
    await history.begin({
      ...meta,
      recordingFile: '2026-11-21 10-00-00 a1b2c3.opus',
    })
    await history.end()
    await history.begin(meta)
    await history.end()
    expect(onRecordingUnlinked).not.toHaveBeenCalled()
  })

  it('marks an entry whose recording stopped early', async () => {
    const recorded = {
      ...meta,
      recordingFile: '2026-11-21 10-00-00 a1b2c3.opus',
    }
    const { history, saved, setText } = setup()
    await history.begin(recorded)
    setText('Me: hi')
    await history.checkpoint()
    await history.markRecordingIncomplete()
    expect(saved.at(-1)).toEqual({
      id: 'entry-1',
      text: 'Me: hi',
      kind: 'dialog',
      dialog: { ...recorded, isRecordingIncomplete: true },
    })
  })

  it('persists the incomplete flag when a text save is already in flight', async () => {
    const recorded = {
      ...meta,
      recordingFile: '2026-11-21 10-00-00 a1b2c3.opus',
    }
    let completeSave!: (id: string) => void
    const inFlight = new Promise<string>((resolve) => {
      completeSave = resolve
    })
    const save = vi
      .fn<(entry: EditorHistoryEntry) => Promise<string | null>>()
      .mockReturnValueOnce(inFlight)
      .mockResolvedValue('entry')
    const { history } = setup({ save })
    const beginning = history.begin(recorded)
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    const marking = history.markRecordingIncomplete()
    completeSave('entry')
    await Promise.all([beginning, marking])
    expect(save).toHaveBeenLastCalledWith({
      id: 'entry',
      text: '',
      kind: 'dialog',
      dialog: { ...recorded, isRecordingIncomplete: true },
    })
  })

  it('leaves no interval behind when a session ends while it begins', async () => {
    const { history } = setup()
    const beginning = history.begin(meta)
    const ending = history.end()
    await Promise.all([beginning, ending])
    expect(vi.getTimerCount()).toBe(0)
  })
})
