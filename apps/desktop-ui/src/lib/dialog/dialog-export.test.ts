import { describe, expect, it } from 'vitest'

import { exportDialogTranscript, formatDialogClock } from './dialog-export'
import type { DialogSegment } from './dialog-transcript'

const labels = { me: 'Me', remote: 'Remote', translation: 'Translation' }
const formatTime = (ms: number) => `00:${String(ms / 1000).padStart(2, '0')}`

function segment(
  patch: Partial<DialogSegment> & Pick<DialogSegment, 'id' | 'side'>
): DialogSegment {
  return {
    startMs: 0,
    endMs: 0,
    text: patch.id,
    isFinal: true,
    translationState: 'idle',
    ...patch,
  }
}

describe('exportDialogTranscript', () => {
  it('writes a block per turn with localized labels', () => {
    const segments = [
      segment({
        id: 'Can we move the release?',
        side: 'remote',
        startMs: 3000,
        translation: 'Можем сдвинуть релиз?',
      }),
      segment({ id: 'Yes', side: 'me', startMs: 9000 }),
    ]
    expect(
      exportDialogTranscript(segments, {
        labels,
        formatTime,
        includeTranslation: true,
      })
    ).toBe(
      [
        '[00:03] Remote: Can we move the release?',
        '        Translation: Можем сдвинуть релиз?',
        '[00:09] Me: Yes',
      ].join('\n')
    )
    expect(
      exportDialogTranscript(segments, {
        labels,
        formatTime,
        includeTranslation: false,
      })
    ).toBe('[00:03] Remote: Can we move the release?\n[00:09] Me: Yes')
  })

  it('leaves out turns without text', () => {
    expect(
      exportDialogTranscript([segment({ id: 'x', side: 'me', text: ' ' })], {
        labels,
        includeTranslation: true,
      })
    ).toBe('')
  })

  it('leaves out the guesses that are not settled', () => {
    expect(
      exportDialogTranscript(
        [
          segment({ id: 'Settled', side: 'remote' }),
          segment({
            id: 'guess',
            side: 'remote',
            startMs: 1000,
            isFinal: false,
          }),
        ],
        { labels, formatTime, includeTranslation: true }
      )
    ).toBe('[00:00] Remote: Settled')
  })

  it('writes the clock time of a turn', () => {
    const epochMs = new Date(2026, 10, 20, 9, 5, 7).getTime()
    expect(formatDialogClock(epochMs)).toBe('09:05:07')
  })
})
