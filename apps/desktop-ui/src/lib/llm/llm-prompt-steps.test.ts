import type { ChatMessage } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { buildLlmPrompt } from './llm-prompt'

const answer: ChatMessage = {
  role: 'assistant',
  content: 'It is noon.',
  parts: [
    { type: 'reasoning', text: 'The user wants the time.' },
    { type: 'text', text: 'Let me check.' },
    {
      type: 'tool-call',
      toolCallId: 'c1',
      toolName: 'get_current_time',
      input: { zone: 'UTC' },
      state: 'done',
    },
    {
      type: 'tool-result',
      toolCallId: 'c1',
      toolName: 'get_current_time',
      output: '12:00',
    },
    {
      type: 'tool-call',
      toolCallId: 'c2',
      toolName: 'delete_file',
      input: {},
      state: 'denied',
    },
    {
      type: 'tool-call',
      toolCallId: 'c3',
      toolName: 'slow',
      input: {},
      state: 'awaiting-approval',
      approvalId: 'a3',
    },
    { type: 'text', text: 'It is noon.' },
  ],
}

const conversation: ChatMessage[] = [
  { role: 'user', content: 'Time?' },
  answer,
  { role: 'user', content: 'Thanks' },
]

describe('llm-prompt steps', () => {
  it('sends tool steps as calls and results to a model with tools', () => {
    const { messages } = buildLlmPrompt(conversation, {
      rulePrefix: 'Rules',
      canUseTools: true,
    })

    expect(messages).toEqual([
      { role: 'user', content: 'Time?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'get_current_time',
            input: { zone: 'UTC' },
          },
          {
            type: 'tool-call',
            toolCallId: 'c2',
            toolName: 'delete_file',
            input: {},
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'get_current_time',
            output: { type: 'text', value: '12:00' },
          },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'delete_file',
            output: { type: 'execution-denied' },
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'It is noon.' }] },
      { role: 'user', content: 'Thanks' },
    ])
  })

  it('retells the steps as text to a model without tools', () => {
    const { messages } = buildLlmPrompt(conversation, { rulePrefix: 'Rules' })

    expect(messages[1]).toEqual({
      role: 'assistant',
      content:
        '[get_current_time({"zone":"UTC"}) → 12:00]\n' +
        '[delete_file({}) → denied]\n' +
        '[slow({}) → not finished]\n\n' +
        'Let me check.\n\nIt is noon.',
    })
  })

  it('reports a failed tool as an error', () => {
    const { messages } = buildLlmPrompt(
      [
        {
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'read',
              input: {},
              state: 'error',
            },
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'read',
              output: 'No such file',
              isError: true,
            },
          ],
        },
      ],
      { rulePrefix: 'Rules', canUseTools: true }
    )

    expect(messages[1]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'read',
          output: { type: 'error-text', value: 'No such file' },
        },
      ],
    })
  })

  it('keeps a plain answer a single text message', () => {
    const { messages } = buildLlmPrompt(
      [{ role: 'assistant', content: 'Hi', parts: [] }],
      { rulePrefix: 'Rules', canUseTools: true }
    )
    expect(messages).toEqual([{ role: 'assistant', content: 'Hi' }])
  })
})
