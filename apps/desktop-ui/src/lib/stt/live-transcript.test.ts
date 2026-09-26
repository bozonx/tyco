import type { TranscriptPart } from '@bozonx/ai-kit'
import { describe, expect, it } from 'vitest'

import {
  applyTranscriptPart,
  createLiveTranscriptState,
  liveTranscriptText,
} from './live-transcript'

const partial = (text: string): TranscriptPart => ({
  type: 'partial',
  text,
  startMs: 0,
})

const final = (text: string): TranscriptPart => ({
  type: 'final',
  segment: { index: 0, startMs: 0, endMs: 1_000, text },
})

function fold(parts: TranscriptPart[]) {
  return parts.reduce(applyTranscriptPart, createLiveTranscriptState())
}

describe('live transcript', () => {
  it('replaces the guess with each partial', () => {
    const state = fold([partial('hel'), partial('hello wor')])

    expect(state).toEqual({ committed: '', draft: 'hello wor' })
    expect(liveTranscriptText(state)).toBe('hello wor')
  })

  it('settles finals, clears the guess and joins them with a space', () => {
    const state = fold([
      partial('hello'),
      final('Hello world.'),
      partial('how'),
      final(' How are you? '),
    ])

    expect(state).toEqual({ committed: 'Hello world. How are you?', draft: '' })
  })

  it('shows the guess after the settled text', () => {
    const state = fold([final('Hello.'), partial('next one')])

    expect(liveTranscriptText(state)).toBe('Hello. next one')
  })

  it('ignores parts that carry no text', () => {
    const state = fold([
      final('Hello.'),
      final('  '),
      { type: 'finish' },
      { type: 'error', kind: 'aborted', message: 'x', recoverable: false },
    ])

    expect(state).toEqual({ committed: 'Hello.', draft: '' })
  })
})
