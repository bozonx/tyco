import { describe, expect, it, vi } from 'vitest'
import type { AiTaskConfig } from '@tyco/shared'

import type { LlmStreamEvent } from '../llm/llm-client'
import type { RegisteredTool } from '../tools/tool-types'
import {
  createTaskRunner,
  FOCUS_LOSS_TIMEOUT_MS,
  STRICT_REPLACE_INSTRUCTION,
  type TaskApprovalRequest,
} from './task-runner'

function makeTask(patch: Partial<AiTaskConfig> = {}): AiTaskConfig {
  return {
    id: 'test-task',
    name: 'Test Task',
    prompt: 'Summarize the text',
    allowedTools: [],
    outputAction: 'replace',
    maxSteps: 5,
    ...patch,
  }
}

describe('TaskRunner', () => {
  it('runs a basic task without tools and returns text and reasoning', async () => {
    let capturedPrompt: any = null
    const stream = async function* (
      _task: any,
      prompt: any,
      _options: any
    ): AsyncIterable<LlmStreamEvent> {
      capturedPrompt = prompt
      yield { type: 'reasoning', text: 'Thinking about summary...' }
      yield { type: 'text', text: 'Short summary' }
      yield {
        type: 'finish',
        finishReason: 'stop',
        text: 'Short summary',
        responseMessages: [],
      }
    }

    const runner = createTaskRunner({ stream, getTool: () => undefined })

    const updates: any[] = []
    const result = await runner.run(
      makeTask({ prompt: 'Be concise', outputAction: 'replace' }),
      'Long original text',
      { onUpdate: (state) => updates.push({ ...state }) }
    )

    expect(result.content).toBe('Short summary')
    expect(result.reasoning).toBe('Thinking about summary...')
    expect(result.effectiveOutputAction).toBe('replace')
    expect(result.wasFocusGuardTriggered).toBe(false)
    expect(capturedPrompt.system).toContain(STRICT_REPLACE_INSTRUCTION)
    expect(capturedPrompt.system).toContain('Instructions:\nBe concise')
    expect(capturedPrompt.messages).toEqual([
      { role: 'user', content: 'Long original text' },
    ])
    expect(updates.at(-1)?.status).toBe('done')
  })

  it('does not include strict replace instruction when outputAction is show', async () => {
    let capturedPrompt: any = null
    const stream = async function* (
      _task: any,
      prompt: any,
      _options: any
    ): AsyncIterable<LlmStreamEvent> {
      capturedPrompt = prompt
      yield { type: 'text', text: 'Here is information' }
      yield {
        type: 'finish',
        finishReason: 'stop',
        text: 'Here is information',
        responseMessages: [],
      }
    }

    const runner = createTaskRunner({ stream, getTool: () => undefined })

    const result = await runner.run(
      makeTask({ outputAction: 'show' }),
      'Input text'
    )

    expect(capturedPrompt.system).not.toContain(STRICT_REPLACE_INSTRUCTION)
    expect(result.effectiveOutputAction).toBe('show')
  })

  it('triggers Focus Loss Guard when duration exceeds 4000ms', async () => {
    let now = 1000
    const stream = async function* (): AsyncIterable<LlmStreamEvent> {
      now += FOCUS_LOSS_TIMEOUT_MS + 500
      yield { type: 'text', text: 'Late answer' }
      yield {
        type: 'finish',
        finishReason: 'stop',
        text: 'Late answer',
        responseMessages: [],
      }
    }

    const runner = createTaskRunner({
      stream,
      getTool: () => undefined,
      now: () => now,
    })

    const result = await runner.run(
      makeTask({ outputAction: 'replace' }),
      'Original text'
    )

    expect(result.effectiveOutputAction).toBe('show')
    expect(result.wasFocusGuardTriggered).toBe(true)
  })

  it('triggers Focus Loss Guard when target window is invalid', async () => {
    const stream = async function* (): AsyncIterable<LlmStreamEvent> {
      yield { type: 'text', text: 'Answer' }
      yield {
        type: 'finish',
        finishReason: 'stop',
        text: 'Answer',
        responseMessages: [],
      }
    }

    const runner = createTaskRunner({
      stream,
      getTool: () => undefined,
      canInsertIntoTarget: () => false,
    })

    const result = await runner.run(
      makeTask({ outputAction: 'replace' }),
      'Original text'
    )

    expect(result.effectiveOutputAction).toBe('show')
    expect(result.wasFocusGuardTriggered).toBe(true)
  })

  it('filters tools by allowedTools and adapts them', async () => {
    let capturedOptions: any = null
    const stream = async function* (
      _task: any,
      _prompt: any,
      options: any
    ): AsyncIterable<LlmStreamEvent> {
      capturedOptions = options
      yield { type: 'text', text: 'Result' }
      yield {
        type: 'finish',
        finishReason: 'stop',
        text: 'Result',
        responseMessages: [],
      }
    }

    const mockTool: RegisteredTool = {
      id: 'core.copy',
      owner: { kind: 'core' },
      description: 'Copy text to clipboard',
      inputSchema: { type: 'object' },
      run: vi.fn(),
    }

    const runner = createTaskRunner({
      stream,
      getTool: (id) => (id === 'core.copy' ? mockTool : undefined),
    })

    await runner.run(
      makeTask({ allowedTools: ['core:copy', 'disallowed.tool'] }),
      'Sample text'
    )

    expect(capturedOptions.tools).toBeDefined()
    expect(Object.keys(capturedOptions.tools)).toEqual(['core_copy'])
  })

  it('handles tool execution and streaming tool calls and results', async () => {
    const mockTool: RegisteredTool = {
      id: 'core.calendar',
      owner: { kind: 'core' },
      description: 'Add event',
      inputSchema: { type: 'object' },
      run: vi.fn().mockResolvedValue({ ok: true, content: 'Event created' }),
    }

    const stream = async function* (): AsyncIterable<LlmStreamEvent> {
      yield {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'core_calendar',
        input: { title: 'Meeting' },
      }
      yield {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'core_calendar',
        output: 'Event created',
        isError: false,
      }
      yield { type: 'text', text: 'I scheduled the meeting.' }
      yield {
        type: 'finish',
        finishReason: 'stop',
        text: 'I scheduled the meeting.',
        responseMessages: [],
      }
    }

    const runner = createTaskRunner({ stream, getTool: () => mockTool })

    const updates: any[] = []
    const result = await runner.run(
      makeTask({ allowedTools: ['core:calendar'] }),
      'Schedule meeting',
      { onUpdate: (state) => updates.push({ ...state }) }
    )

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({
      toolCallId: 'call-1',
      toolId: 'core.calendar',
      toolName: 'core_calendar',
      status: 'done',
      output: 'Event created',
    })
  })

  it('pauses for tool approval and continues when approved', async () => {
    const mockTool: RegisteredTool = {
      id: 'core.delete',
      owner: { kind: 'core' },
      description: 'Delete item',
      inputSchema: { type: 'object' },
      run: vi.fn(),
    }

    let turn = 0
    let secondTurnMessages: any = null

    const stream = async function* (
      _task: any,
      prompt: any,
      _options: any
    ): AsyncIterable<LlmStreamEvent> {
      if (turn === 0) {
        turn = 1
        yield {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'core_delete',
          input: { id: 'file-1' },
        }
        yield {
          type: 'approval-request',
          approvalId: 'appr-1',
          toolCallId: 'call-1',
          toolName: 'core_delete',
          input: { id: 'file-1' },
        }
        yield {
          type: 'finish',
          finishReason: 'tool-calls',
          text: '',
          responseMessages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'call-1',
                  toolName: 'core_delete',
                  input: { id: 'file-1' },
                },
              ],
            },
          ],
        }
      } else {
        secondTurnMessages = prompt.messages
        yield { type: 'text', text: 'Item deleted.' }
        yield {
          type: 'finish',
          finishReason: 'stop',
          text: 'Item deleted.',
          responseMessages: [],
        }
      }
    }

    const requestApproval = vi.fn(async (_req: TaskApprovalRequest) => true)

    const runner = createTaskRunner({
      stream,
      getTool: () => mockTool,
      getToolPolicy: () => 'ask',
      requestApproval,
    })

    const result = await runner.run(
      makeTask({ allowedTools: ['core:delete'] }),
      'Delete it'
    )

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'appr-1',
        toolCallId: 'call-1',
        toolId: 'core.delete',
      }),
      expect.any(AbortSignal)
    )
    expect(secondTurnMessages).toBeDefined()
    expect(result.content).toBe('Item deleted.')
  })

  it('aborts when signal is cancelled', async () => {
    const controller = new AbortController()

    const stream = async function* (): AsyncIterable<LlmStreamEvent> {
      yield { type: 'text', text: 'Part 1' }
      controller.abort()
      yield { type: 'text', text: 'Part 2' }
    }

    const runner = createTaskRunner({ stream, getTool: () => undefined })

    await expect(
      runner.run(makeTask(), 'Input', { signal: controller.signal })
    ).rejects.toThrow('Task execution was cancelled')
  })
})
