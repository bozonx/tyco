import { describe, expect, it, vi } from 'vitest'

import { createQuickAiRequestSession } from './quick-ai-request-session'

function setup() {
  const made: { chatId: string; profileId: string | null }[] = []
  const tools = () => ({ dispose: vi.fn() })
  const session = createQuickAiRequestSession({
    createId: () => 'chat-1',
    createTools: (scope) => {
      made.push({ chatId: scope.chatId, profileId: scope.profileId })
      return tools()
    },
  })
  return { session, made }
}

describe('quick-ai-request-session', () => {
  it('keeps one chat id and one tools session per profile', () => {
    const { session, made } = setup()
    const first = session.toolsFor('writer')
    expect(session.toolsFor('writer')).toBe(first)
    expect(made).toEqual([{ chatId: 'chat-1', profileId: 'writer' }])
    expect(session.chatId).toBe('chat-1')
  })

  it('starts the tools over for another profile', () => {
    const { session } = setup()
    const first = session.toolsFor('writer')
    const second = session.toolsFor(null)
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second).not.toBe(first)
    expect(session.currentTools()).toBe(second)
  })

  it('cancels waiting calls when it ends', () => {
    const { session } = setup()
    const tools = session.toolsFor(null)
    session.dispose()
    expect(tools.dispose).toHaveBeenCalledOnce()
    expect(session.currentTools()).toBeUndefined()
    expect(() => session.toolsFor(null)).toThrow()
  })
})
