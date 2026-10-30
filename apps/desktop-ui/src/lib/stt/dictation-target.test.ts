import { describe, expect, it } from 'vitest'
import { resolveDictationTarget } from './dictation-target'

describe('resolveDictationTarget', () => {
  it('prefers explicit target when provided', () => {
    expect(
      resolveDictationTarget({
        target: 'editor',
        finishBehavior: 'insertIntoTarget',
      })
    ).toBe('editor')
    expect(
      resolveDictationTarget({
        target: 'chat',
        finishBehavior: 'insertIntoTarget',
      })
    ).toBe('chat')
    expect(resolveDictationTarget({ target: 'external', chat: true })).toBe(
      'external'
    )
  })

  it('resolves finishBehavior insertIntoTarget as external', () => {
    expect(resolveDictationTarget({ finishBehavior: 'insertIntoTarget' })).toBe(
      'external'
    )
  })

  it('resolves chat options as chat', () => {
    expect(resolveDictationTarget({ chat: true })).toBe('chat')
    expect(resolveDictationTarget({ finishBehavior: 'submitToChat' })).toBe(
      'chat'
    )
  })

  it('resolves inline editor dictation as editor', () => {
    expect(resolveDictationTarget({ inline: true })).toBe('editor')
  })

  it('defaults to external when no specific option is matched', () => {
    expect(resolveDictationTarget({})).toBe('external')
  })
})
