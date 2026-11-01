import type { ToolSet } from '@bozonx/ai-kit'
import { expect, it, vi } from 'vitest'

import type { LlmStreamEvent, LlmStreamOptions } from '../llm/llm-client'
import type { LlmPrompt } from '../llm/llm-prompt'
import { createAiCommandRunner } from './ai-command-runner'

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
    expect(results[1]).toContain('Command call limit reached')
    expect(results[2]).toContain('Command call limit reached')
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
