import type { TranscriptPart } from '@bozonx/ai-kit'
import { describe, expect, it } from 'vitest'

import {
  applyTranscriptPart,
  createLiveTranscriptState,
  hasNewTranscriptSpeech,
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

  it('joins segments of unspaced scripts without a space', () => {
    expect(liveTranscriptText({ committed: '你好。', draft: '世界' })).toBe(
      '你好。世界'
    )
    expect(liveTranscriptText({ committed: 'สวัสดี', draft: 'ครับ' })).toBe(
      'สวัสดีครับ'
    )
    expect(liveTranscriptText({ committed: '你好', draft: 'world' })).toBe(
      '你好 world'
    )
  })

  it('counts new words as speech and ignores retracted draft guesses', () => {
    const empty = createLiveTranscriptState()
    const draftNoise = { committed: '', draft: 'uh' }
    expect(hasNewTranscriptSpeech(empty, draftNoise)).toBe(true)
    // Retracting a draft back to empty is not speech
    expect(hasNewTranscriptSpeech(draftNoise, empty)).toBe(false)

    const settled = { committed: 'Heard', draft: '' }
    // Settling the exact same words as the draft does not add new words
    expect(
      hasNewTranscriptSpeech({ committed: '', draft: 'Heard' }, settled)
    ).toBe(false)
    // Retracting a draft after settled text is not speech
    expect(
      hasNewTranscriptSpeech({ committed: 'Heard', draft: 'noise' }, settled)
    ).toBe(false)
    // A final that revises the draft words is new speech
    expect(
      hasNewTranscriptSpeech(
        { committed: '', draft: 'Helo' },
        { committed: 'Hello', draft: '' }
      )
    ).toBe(true)
  })
})
