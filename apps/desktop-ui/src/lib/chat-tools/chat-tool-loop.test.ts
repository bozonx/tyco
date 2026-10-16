import type { ModelMessage } from '@bozonx/ai-kit'
import { describe, expect, it, vi } from 'vitest'

import type { LlmStreamEvent } from '../llm/llm-client'
import { createFakeLlmStream, textAnswer } from '../llm/testing'
import { runChatToolLoop, type ChatToolLoopState } from './chat-tool-loop'
import { createChatToolPolicy } from './chat-tool-policy'
import type { ChatToolSet } from './chat-tool-registry'

const prompt = {
  messages: [{ role: 'user', content: 'Time?' }] as ModelMessage[],
}

const toolSet: ChatToolSet = {
  tools: {},
  toolApproval: () => 'approved',
  definitions: new Map(),
  truncatedCallIds: new Set(),
}

const assistantCall: ModelMessage = {
  role: 'assistant',
  content: [
    { type: 'tool-call', toolCallId: 'c1', toolName: 'now', input: {} },
    { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1' },
  ],
}

const approvalStop: LlmStreamEvent[] = [
  { type: 'model', provider: 'fake', model: 'fake-model' },
  { type: 'text', text: 'Let me check.' },
  { type: 'tool-call', toolCallId: 'c1', toolName: 'now', input: {} },
  {
    type: 'approval-request',
    approvalId: 'a1',
    toolCallId: 'c1',
    toolName: 'now',
    input: {},
  },
  { type: 'step-finish', step: 0, finishReason: 'tool-calls' },
  {
    type: 'finish',
    finishReason: 'tool-calls',
    text: 'Let me check.',
    responseMessages: [assistantCall],
  },
]

const afterApproval: LlmStreamEvent[] = [
  { type: 'model', provider: 'fake', model: 'fake-model' },
  {
    type: 'tool-result',
    toolCallId: 'c1',
    toolName: 'now',
    output: '12:00',
    isError: false,
  },
  { type: 'text', text: 'It is noon.' },
  { type: 'step-finish', step: 0, finishReason: 'stop' },
  {
    type: 'finish',
    finishReason: 'stop',
    text: 'It is noon.',
    responseMessages: [],
  },
]

function setup(
  script: Parameters<typeof createFakeLlmStream>[0],
  decision: 'allow-once' | 'allow-session' | 'deny' = 'allow-once'
) {
  const fake = createFakeLlmStream(script)
  const policy = createChatToolPolicy({ canAsk: true })
  const requestApproval = vi.fn(async () => decision)
  const updates: ChatToolLoopState[] = []
  const deps = { stream: fake.stream, requestApproval, policy }
  const input = {
    prompt,
    tools: toolSet,
    maxStepCount: 8,
    signal: new AbortController().signal,
    onUpdate: (state: ChatToolLoopState) => updates.push(state),
  }
  return { fake, policy, requestApproval, updates, deps, input }
}

describe('chat-tool-loop', () => {
  it('is one plain call without tools', async () => {
    const { deps, input, fake } = setup([textAnswer('Hello')])

    const result = await runChatToolLoop(deps, { ...input, tools: null })

    expect(result).toEqual({
      content: 'Hello',
      parts: [{ type: 'text', text: 'Hello' }],
    })
    expect(fake.calls[0].options.tools).toBeUndefined()
  })

  it('records the steps and continues after an approval', async () => {
    const { deps, input, fake, requestApproval, updates } = setup([
      approvalStop,
      afterApproval,
    ])
    let stateWhileAsking: unknown
    requestApproval.mockImplementation(async () => {
      stateWhileAsking = structuredClone(updates.at(-1)?.parts[1])
      return 'allow-once'
    })

    const result = await runChatToolLoop(deps, input)

    expect(requestApproval).toHaveBeenCalledWith(
      { approvalId: 'a1', toolCallId: 'c1', toolName: 'now', input: {} },
      input.signal
    )
    expect(stateWhileAsking).toMatchObject({
      state: 'awaiting-approval',
      approvalId: 'a1',
    })
    expect(result.content).toBe('Let me check.\n\nIt is noon.')
    expect(result.parts).toEqual([
      { type: 'text', text: 'Let me check.' },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'now',
        input: {},
        state: 'done',
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'now',
        output: '12:00',
      },
      { type: 'text', text: 'It is noon.' },
    ])
    expect(fake.calls[1].prompt.messages).toEqual([
      ...prompt.messages,
      assistantCall,
      {
        role: 'tool',
        content: [
          { type: 'tool-approval-response', approvalId: 'a1', approved: true },
        ],
      },
    ])
    // one step was used before the approval
    expect(fake.calls[0].options.maxSteps).toBe(8)
    expect(fake.calls[1].options.maxSteps).toBe(7)
  })

  it('tells the model about a refused call', async () => {
    const denied: LlmStreamEvent[] = [
      { type: 'model', provider: 'fake', model: 'fake-model' },
      { type: 'tool-denied', toolCallId: 'c1', toolName: 'now' },
      ...textAnswer('I could not check.').slice(1),
    ]
    const { deps, input, fake } = setup([approvalStop, denied], 'deny')

    const result = await runChatToolLoop(deps, input)

    expect(result.parts[1]).toMatchObject({
      type: 'tool-call',
      state: 'denied',
    })
    expect(fake.calls[1].prompt.messages.at(-1)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-approval-response',
          approvalId: 'a1',
          approved: false,
          reason: 'The user did not allow this tool call.',
        },
      ],
    })
  })

  it('remembers a permission for the session', async () => {
    const { deps, input, policy } = setup(
      [approvalStop, afterApproval],
      'allow-session'
    )

    await runChatToolLoop(deps, input)

    expect(policy.isAllowedForSession('now')).toBe(true)
  })

  it('offers no tools on the last step', async () => {
    const { deps, input, fake } = setup([textAnswer('Done')])

    await runChatToolLoop(deps, { ...input, maxStepCount: 3 })

    const prepareStep = fake.calls[0].options.prepareStep!
    const step = (stepNumber: number) =>
      (prepareStep as (options: { stepNumber: number }) => unknown)({
        stepNumber,
      })
    expect(step(0)).toBeUndefined()
    expect(step(2)).toEqual({ activeTools: [] })
  })

  it('fails as a step limit when an approval comes at the last step', async () => {
    const { deps, input } = setup([approvalStop])

    await expect(
      runChatToolLoop(deps, { ...input, maxStepCount: 1 })
    ).rejects.toMatchObject({
      kind: 'step_limit',
      partialText: 'Let me check.',
    })
  })

  it('stops while waiting for an approval when aborted', async () => {
    const controller = new AbortController()
    const { deps, input, fake } = setup([approvalStop, afterApproval])
    deps.requestApproval.mockImplementation(async () => {
      controller.abort()
      return 'allow-once'
    })

    const result = await runChatToolLoop(deps, {
      ...input,
      signal: controller.signal,
    })

    expect(fake.calls).toHaveLength(1)
    expect(result.parts[1]).toMatchObject({ state: 'awaiting-approval' })
  })

  it('marks a failed and a cut output', async () => {
    const { deps, input } = setup([
      [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: {} },
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'read',
          output: new Error('No such file'),
          isError: true,
        },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'read', input: {} },
        {
          type: 'tool-result',
          toolCallId: 'c2',
          toolName: 'read',
          output: 'part',
          isError: false,
        },
        ...textAnswer('Done').slice(1),
      ],
    ])

    const result = await runChatToolLoop(deps, {
      ...input,
      tools: { ...toolSet, truncatedCallIds: new Set(['c2']) },
    })

    expect(result.parts.slice(0, 4)).toEqual([
      expect.objectContaining({ toolCallId: 'c1', state: 'error' }),
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'read',
        output: 'No such file',
        isError: true,
      },
      expect.objectContaining({ toolCallId: 'c2', state: 'done' }),
      {
        type: 'tool-result',
        toolCallId: 'c2',
        toolName: 'read',
        output: 'part',
        isTruncated: true,
      },
    ])
  })
})
