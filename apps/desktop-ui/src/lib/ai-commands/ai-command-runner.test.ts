import type { ToolSet } from '@bozonx/ai-kit'
import { expect, it, vi } from 'vitest'

import type { LlmStreamEvent, LlmStreamOptions } from '../llm/llm-client'
import type { LlmPrompt } from '../llm/llm-prompt'
import { CALL_LIMIT_NOTICE, createAiCommandRunner } from './ai-command-runner'

it('caps parallel command execution and disables tools for the final answer', async () => {
  const execute = vi.fn(async () => ({ ok: true, content: 'Done' }))
  async function* stream(
    _task: string,
    _prompt: LlmPrompt,
    options: LlmStreamOptions = {}
  ): AsyncGenerator<LlmStreamEvent> {
    const tool = Object.values(options.tools as ToolSet)[0]!
    const call = tool.execute!
    const results = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        call(
          {},
          {
            toolCallId: String(index),
            messages: [],
            context: undefined,
            abortSignal: options.signal,
          }
        )
      )
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(results[1]).toBe(CALL_LIMIT_NOTICE)
    expect(results[2]).toBe(CALL_LIMIT_NOTICE)
    expect(options.maxSteps).toBe(2)
    expect(
      await options.prepareStep!({ stepNumber: 1 } as Parameters<
        NonNullable<LlmStreamOptions['prepareStep']>
      >[0])
    ).toEqual({ activeTools: [], toolChoice: 'none' })
    yield { type: 'text', text: 'Finished' }
  }
  const run = createAiCommandRunner({ stream, instructions: () => '' })
  expect(
    await run(
      { prompt: 'Do it', allowedCommandIds: ['one'], maxSteps: 1 },
      '',
      [
        {
          commandId: 'one',
          label: 'One',
          description: 'Does it',
          inputSchema: { type: 'object', properties: {} },
          execute,
        },
      ],
      { signal: new AbortController().signal }
    )
  ).toBe('Finished')
})

it('answers with the output of the last command when the model says nothing after it', async () => {
  async function* stream(
    _task: string,
    _prompt: LlmPrompt,
    options: LlmStreamOptions = {}
  ): AsyncGenerator<LlmStreamEvent> {
    const tool = Object.values(options.tools as ToolSet)[0]!
    yield { type: 'text', text: 'Running it. ' }
    yield { type: 'tool-call', toolCallId: '1', toolName: 'c0_one', input: {} }
    await tool.execute!(
      {},
      {
        toolCallId: '1',
        messages: [],
        context: undefined,
        abortSignal: options.signal,
      }
    )
  }
  const run = createAiCommandRunner({ stream, instructions: () => '' })
  expect(
    await run(
      { prompt: 'Do it', allowedCommandIds: ['one'], maxSteps: 1 },
      '',
      [
        {
          commandId: 'one',
          label: 'One',
          description: 'Does it',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => ({ ok: true, content: 'Output of one' }),
        },
      ],
      { signal: new AbortController().signal }
    )
  ).toBe('Output of one')
})
