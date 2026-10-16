import { describe, expect, it } from 'vitest'

import { createChatToolPolicy } from './chat-tool-policy'

describe('chat-tool-policy', () => {
  it('maps access to approval and remembers a session permission', () => {
    const policy = createChatToolPolicy({ canAsk: true })

    expect(policy.decide('read', 'allow')).toBe('approved')
    expect(policy.decide('read', 'deny')).toBe('denied')
    expect(policy.decide('write', 'ask')).toBe('user-approval')

    expect(policy.answer('write', 'allow-once')).toBe(true)
    expect(policy.decide('write', 'ask')).toBe('user-approval')
    expect(policy.answer('write', 'allow-session')).toBe(true)
    expect(policy.decide('write', 'ask')).toBe('approved')
    // a session permission never lifts a denial
    expect(policy.decide('write', 'deny')).toBe('denied')
    expect(policy.answer('delete', 'deny')).toBe(false)

    policy.reset()
    expect(policy.decide('write', 'ask')).toBe('user-approval')
  })

  it('treats ask as deny when nobody can answer', () => {
    const policy = createChatToolPolicy({ canAsk: false })

    expect(policy.decide('write', 'ask')).toBe('denied')
    expect(policy.decide('read', 'allow')).toBe('approved')
  })
})
