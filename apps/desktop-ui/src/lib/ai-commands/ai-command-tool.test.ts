import type { ToolSet } from '@bozonx/ai-kit'
import { describe, expect, it, vi } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import { createCommand } from '../commands/command-config'
import { createCommandTransformer } from '../commands/command-runner'
import type { LlmStreamEvent, LlmStreamOptions } from '../llm/llm-client'
import type { LlmPrompt } from '../llm/llm-prompt'
import {
  TEXT_INPUT_SCHEMA,
  type RegisteredTool,
  type ToolCall,
} from '../tools/tool-types'
import { AI_COMMAND_MAX_DEPTH, createAiCommandTool } from './ai-command-tool'

const aiCommand = (
  id: string,
  allowedCommandIds: string[] = [],
  prompt = `Prompt of ${id}`
): CommandConfig => ({
  ...createCommand('core.aiTask', id),
  name: id.toUpperCase(),
  toolConfig: { prompt, allowedCommandIds, maxSteps: 4 },
})

const script = (id: string): CommandConfig => ({
  ...createCommand('script', id),
  name: id.toUpperCase(),
  description: `Runs ${id}`,
})

/** A model step: answer with text, or call the tool of a command first */
type Turn = { call: string; input?: Record<string, unknown> } | string

interface StreamCall {
  system: string | undefined
  text: string
  /** The commands offered, by the id the tool name ends with */
  offered: string[]
  maxSteps: number | undefined
}

/**
 * A model that plays `turns` per AI command, by its prompt: it calls the tools
 * the turns name, then answers
 */
function fakeModel(turnsByPrompt: Record<string, Turn[]>) {
  const calls: StreamCall[] = []
  const commandIdOf = (name: string) => name.replace(/^c\d+_/, '')
  async function* stream(
    _task: string,
    prompt: LlmPrompt,
    options: LlmStreamOptions = {}
  ): AsyncGenerator<LlmStreamEvent> {
    const tools: ToolSet = options.tools ?? {}
    const names = Object.keys(tools)
    const text = String(prompt.messages[0]?.content ?? '')
    calls.push({
      system: prompt.system,
      text,
      offered: names.map(commandIdOf),
      maxSteps: options.maxSteps,
    })
    const key = Object.keys(turnsByPrompt).find((item) =>
      prompt.system?.includes(item)
    )
    for (const turn of turnsByPrompt[key ?? ''] ?? []) {
      if (typeof turn === 'string') {
        yield { type: 'text', text: turn }
        continue
      }
      const name = names.find((item) => commandIdOf(item) === turn.call)
      if (!name) throw new Error(`No tool for ${turn.call}`)
      yield { type: 'text', text: 'Let me run it. ' }
      yield {
        type: 'tool-call',
        toolCallId: name,
        toolName: name,
        input: turn.input ?? { text },
      }
      const execute = (
        tools[name] as unknown as {
          execute: (input: unknown, options: object) => Promise<unknown>
        }
      ).execute
      const output = await execute(turn.input ?? { text }, {
        toolCallId: name,
        messages: [],
        abortSignal: options.signal,
      })
      yield {
        type: 'tool-result',
        toolCallId: name,
        toolName: name,
        output,
        isError: false,
      }
    }
  }
  return { stream, calls }
}

function setup(
  commands: CommandConfig[],
  turnsByPrompt: Record<string, Turn[]> = {}
) {
  const model = fakeModel(turnsByPrompt)
  const ran: { id: string; input: Record<string, unknown> }[] = []
  /** Stands for any tool but AI commands: it says which command it ran */
  const scriptTool: RegisteredTool = {
    id: 'script',
    owner: { kind: 'core' },
    labelKey: 'tools.script',
    description: 'Runs a script',
    inputSchema: TEXT_INPUT_SCHEMA,
    run: async (call) => {
      ran.push({ id: call.command?.id ?? '', input: call.input })
      return { ok: true, content: `${call.command?.id} done` }
    },
  }
  // nested runs go through the real command runner, as in the app
  const transform = createCommandTransformer({
    tools: {
      get: (id) =>
        id === 'script'
          ? scriptTool
          : id === 'core.aiTask'
            ? { ...tool, owner: { kind: 'core' } }
            : undefined,
    },
  })
  const tool = createAiCommandTool({
    stream: model.stream,
    instructions: () => 'App instructions',
    commands: () => commands,
    commandInputSchema: (command) =>
      command.toolId === 'gone' ? undefined : TEXT_INPUT_SCHEMA,
    runCommand: async (command, input, options) => {
      if (command.toolId === 'core.aiTask') ran.push({ id: command.id, input })
      return transform(
        command,
        typeof input.text === 'string' ? input.text : '',
        // a wrapped signal, as a timeout would give: the chain must not ride on it
        {
          ...options,
          signal: AbortSignal.any([options.signal]),
          input,
          output: 'return',
        }
      )
    },
    getUnavailableReasonKey: () => undefined,
    describeError: (error) => (error as Error).message,
  })
  const run = (
    command: CommandConfig,
    text = 'the text',
    extra: Partial<ToolCall> = {}
  ) =>
    tool.run({
      input: { text },
      config: command.toolConfig,
      source: 'launcher',
      signal: new AbortController().signal,
      command: { id: command.id, name: command.name, isOutputLogged: false },
      isOutputRequested: true,
      ...extra,
    })
  return { tool, run, calls: model.calls, ran }
}

describe('createAiCommandTool', () => {
  it('follows the prompt of the command and answers with the text', async () => {
    const command = aiCommand('a')
    const { run, calls } = setup([command], { 'Prompt of a': ['Result'] })
    expect(await run(command)).toEqual({
      ok: true,
      content: 'Result',
      message: 'Result',
    })
    expect(calls[0]).toMatchObject({
      text: 'the text',
      offered: [],
      maxSteps: undefined,
    })
    expect(calls[0]?.system).toBe(
      'App instructions\n\nCommand instructions:\n\nPrompt of a'
    )
  })

  it('runs the commands it may and answers after the last one', async () => {
    const command = aiCommand('a', ['one', 'two'])
    const onProgress = vi.fn()
    const { run, calls, ran } = setup([command, script('one'), script('two')], {
      'Prompt of a': [
        { call: 'two', input: { text: 'for two' } },
        'Two is done',
      ],
    })
    expect(await run(command, 'the text', { onProgress })).toMatchObject({
      ok: true,
      content: 'Two is done',
    })
    expect(calls[0]).toMatchObject({ offered: ['one', 'two'], maxSteps: 5 })
    expect(ran).toEqual([{ id: 'two', input: { text: 'for two' } }])
    expect(onProgress).toHaveBeenCalledWith('TWO')
  })

  it('never offers the command itself, nor a command up its chain', async () => {
    const a = aiCommand('a', ['a', 'b', 'one'])
    const b = aiCommand('b', ['a', 'b', 'one'])
    const { run, calls } = setup([a, b, script('one')], {
      'Prompt of a': [{ call: 'b' }, 'A done'],
      'Prompt of b': ['B done'],
    })
    expect(await run(a)).toMatchObject({ ok: true, content: 'A done' })
    expect(calls.map((call) => call.offered)).toEqual([['b', 'one'], ['one']])
  })

  it('keeps the chain when a nested run gets a signal of its own', async () => {
    const a = aiCommand('a', ['b'])
    const b = aiCommand('b', ['a'])
    const { run, calls } = setup([a, b], {
      'Prompt of a': [{ call: 'b' }, 'A done'],
      'Prompt of b': ['B done'],
    })
    expect(await run(a)).toMatchObject({ ok: true, content: 'A done' })
    expect(calls.map((call) => call.offered)).toEqual([['b'], []])
  })

  it('runs no commands deeper than the nesting limit', async () => {
    const ids = Array.from(
      { length: AI_COMMAND_MAX_DEPTH + 1 },
      (_, index) => `n${index}`
    )
    const commands = ids.map((id, index) =>
      aiCommand(id, ids[index + 1] ? [ids[index + 1]!] : [])
    )
    const { run, calls } = setup(
      commands,
      Object.fromEntries(
        ids.map((id, index) => [
          `Prompt of ${id}`,
          [
            ...(index < AI_COMMAND_MAX_DEPTH - 1
              ? [{ call: ids[index + 1]! }]
              : []),
            `${id} done`,
          ],
        ])
      )
    )
    expect(await run(commands[0]!)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(AI_COMMAND_MAX_DEPTH)
    expect(calls.at(-1)?.offered).toEqual([])
  })

  it('leaves out commands that are disabled, gone or cannot run now', async () => {
    const command = aiCommand('a', ['off', 'missing', 'broken', 'one'])
    const { run, calls } = setup(
      [
        command,
        { ...script('off'), isEnabled: false },
        { ...script('broken'), toolId: 'gone' },
        script('one'),
      ],
      { 'Prompt of a': ['ok'] }
    )
    await run(command)
    expect(calls[0]?.offered).toEqual(['one'])
  })

  it('runs a self-contained prompt without input text', async () => {
    const command = aiCommand('a')
    const { run, calls } = setup([command], {
      'Prompt of a': ['Happy birthday!'],
    })
    expect(await run(command, '')).toMatchObject({
      ok: true,
      content: 'Happy birthday!',
    })
    expect(calls[0]?.text).toBe('Carry out the command instructions.')
  })

  it('requires command instructions even without input text', async () => {
    const { run } = setup([])
    expect(await run(aiCommand('a', [], ' '), '')).toEqual({
      ok: false,
      messageKey: 'commands.errorNoPrompt',
    })
  })

  it('reports an empty answer, a failure and a cancellation', async () => {
    const command = aiCommand('a')
    expect(await setup([command]).run(command)).toEqual({
      ok: false,
      messageKey: 'selection.emptyResult',
    })

    const broken = createAiCommandTool({
      stream: () => {
        throw new Error('Rate limit')
      },
      instructions: () => '',
      commands: () => [],
      commandInputSchema: () => undefined,
      runCommand: async () => ({ ok: true }),
      getUnavailableReasonKey: () => undefined,
      describeError: (error) => (error as Error).message,
    })
    const call: ToolCall = {
      input: { text: 'x' },
      config: command.toolConfig,
      source: 'launcher',
      signal: new AbortController().signal,
      isOutputRequested: true,
    }
    expect(await broken.run(call)).toEqual({ ok: false, message: 'Rate limit' })

    const controller = new AbortController()
    controller.abort()
    expect(await broken.run({ ...call, signal: controller.signal })).toEqual({
      ok: false,
      cancelled: true,
    })
  })

  it('shows the start of a long answer of a command without output', async () => {
    const command = aiCommand('a')
    const long = 'word '.repeat(100)
    const result = await setup([command], { 'Prompt of a': [long] }).run(
      command
    )
    expect(result.content).toBe(long)
    expect(result.message?.length).toBeLessThanOrEqual(281)
    expect(result.message?.endsWith('…')).toBe(true)
  })

  it('fills the variables of its prompt, and does not run without their values', async () => {
    const prompts: string[] = []
    const make = (variables: Record<string, string>) =>
      createAiCommandTool({
        stream: async function* (_task: unknown, prompt: unknown) {
          prompts.push(JSON.stringify(prompt))
          yield { type: 'text-delta', text: 'done' }
        } as never,
        instructions: () => '',
        commands: () => [],
        commandInputSchema: () => undefined,
        runCommand: async () => ({ ok: true }),
        getUnavailableReasonKey: () => undefined,
        describeError: (error) => (error as Error).message,
        variables: () => variables,
      })
    const call: ToolCall = {
      input: { text: 'x' },
      config: { prompt: 'Look in {{var:NOTES_DIR}}', allowedCommandIds: [] },
      source: 'launcher',
      signal: new AbortController().signal,
      isOutputRequested: true,
    }
    expect(await make({}).run(call)).toEqual({
      ok: false,
      messageKey: 'toast.variablesNotSet',
      message: 'NOTES_DIR',
    })
    expect(prompts).toEqual([])
    await make({ NOTES_DIR: '/home/me/notes' }).run(call)
    expect(prompts.join('')).toContain('Look in /home/me/notes')
    expect(prompts.join('')).not.toContain('{{var:')
  })
})
