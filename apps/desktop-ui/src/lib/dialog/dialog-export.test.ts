import { describe, expect, it } from 'vitest'

import { exportDialogTranscript, formatDialogTime } from './dialog-export'
import type { DialogSegment } from './dialog-transcript'

const labels = { me: 'Me', remote: 'Remote', translation: 'Translation' }

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
      exportDialogTranscript(segments, { labels, includeTranslation: true })
    ).toBe(
      [
        '[00:03] Remote: Can we move the release?',
        '        Translation: Можем сдвинуть релиз?',
        '[00:09] Me: Yes',
      ].join('\n')
    )
    expect(
      exportDialogTranscript(segments, { labels, includeTranslation: false })
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

  it('formats times past an hour', () => {
    expect(formatDialogTime(65_000)).toBe('01:05')
    expect(formatDialogTime(3_725_000)).toBe('1:02:05')
    expect(formatDialogTime(-5)).toBe('00:00')
  })
})
