import type { ChatMessage } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  applyAnswerState,
  hasAnswer,
  messageSteps,
  settleUnfinishedToolCalls,
} from './chat-message-steps'

const call = (
  toolCallId: string,
  state: 'pending' | 'awaiting-approval' | 'done'
) => ({
  type: 'tool-call' as const,
  toolCallId,
  toolName: 'now',
  input: {},
  state,
  ...(state === 'awaiting-approval' ? { approvalId: `a-${toolCallId}` } : {}),
})

describe('chat-message-steps', () => {
  it('stores a plain answer without parts', () => {
    const message: ChatMessage = { role: 'assistant', content: '' }
    applyAnswerState(message, {
      content: 'Hi',
      parts: [{ type: 'text', text: 'Hi' }],
    })
    expect(message).toEqual({ role: 'assistant', content: 'Hi' })

    applyAnswerState(message, { content: '', parts: [call('c1', 'done')] })
    expect(message.parts).toHaveLength(1)
    expect(hasAnswer(message)).toBe(true)
    expect(hasAnswer({ content: '', parts: [] })).toBe(false)
  })

  it('closes the calls a stopped answer left open', () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
      parts: [
        call('c1', 'awaiting-approval'),
        call('c2', 'pending'),
        call('c3', 'done'),
      ],
    }

    settleUnfinishedToolCalls(message)

    expect(message.parts).toEqual([
      { ...call('c1', 'done'), state: 'denied' },
      { ...call('c2', 'pending'), state: 'error' },
      call('c3', 'done'),
    ])
  })
})

describe('messageSteps', () => {
  it('pairs each call with its result and keeps plain answers plain', () => {
    expect(messageSteps({ role: 'assistant', content: 'Hi' })).toBeNull()
    expect(
      messageSteps({
        role: 'assistant',
        content: 'Hi',
        parts: [{ type: 'reasoning', text: 'x' }],
      })
    ).toBeNull()

    const result = {
      type: 'tool-result' as const,
      toolCallId: 'c1',
      toolName: 'now',
      output: '12:00',
    }
    expect(
      messageSteps({
        role: 'assistant',
        content: 'It is noon.',
        parts: [
          { type: 'reasoning', text: 'thinking' },
          call('c1', 'done'),
          result,
          { type: 'text', text: '' },
          { type: 'text', text: 'It is noon.' },
        ],
      })
    ).toEqual([
      { type: 'tool', call: call('c1', 'done'), result },
      { type: 'text', text: 'It is noon.' },
    ])
  })
})
