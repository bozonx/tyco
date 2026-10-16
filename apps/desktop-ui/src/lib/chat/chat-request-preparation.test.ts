import type { ChatMessage } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { prepareGenerationRequest } from './chat-request-preparation'
import { createChatState } from './chat-state'

const history = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, index) => [
    { role: 'user' as const, content: `q${index}`.padEnd(10, '.') },
    { role: 'assistant' as const, content: `a${index}`.padEnd(10, '.') },
  ]).flat()

function prepare(reservesToolSteps: boolean) {
  const state = createChatState()
  state.messages.value = history(4)
  return prepareGenerationRequest(
    {
      getChatModel: () => ({
        id: 'model',
        budgetCharacters: 85,
        reservesToolSteps,
      }),
      notifyError: vi.fn(),
      noModelError: () => 'no model',
      messageTooLongError: () => 'too long',
    },
    state,
    'hello',
    [],
    []
  )!
}

describe('chat-request-preparation', () => {
  it('keeps part of the budget for the steps of a turn with tools', () => {
    // 80 characters left for the history: four turns of 20 fit
    expect(prepare(false).prevMessages).toHaveLength(8)
    // a quarter of it is kept for tool results: three turns fit
    expect(prepare(true).prevMessages).toHaveLength(6)
    expect(prepare(true).trimmedTurnCount).toBe(1)
  })
})
