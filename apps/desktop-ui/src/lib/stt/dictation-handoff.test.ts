import { describe, expect, it } from 'vitest'
import { createDictationHandoff } from './dictation-handoff'

describe('dictation handoff', () => {
  it('delivers the draft once to the intended activation', () => {
    const handoff = createDictationHandoff()
    handoff.set('Keep these words', 'listen', 42)
    expect(handoff.take('listen', 42)).toBe('Keep these words')
    expect(handoff.take('listen', 42)).toBe('')
  })
  it('does not reuse a draft in an unrelated activation', () => {
    const handoff = createDictationHandoff()
    handoff.set('Old words', 'voice', 42)
    expect(handoff.take('voice', 43)).toBe('')
    expect(handoff.take('voice', 42)).toBe('')
  })
})
