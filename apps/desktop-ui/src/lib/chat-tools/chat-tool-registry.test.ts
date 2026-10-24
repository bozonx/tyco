import type { ProfileToolSettings } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createChatToolPolicy } from './chat-tool-policy'
import {
  createChatToolRegistry,
  type ChatToolDefinition,
  type ChatToolProvider,
} from './chat-tool-registry'

function tool(overrides: Partial<ChatToolDefinition> = {}): ChatToolDefinition {
  return {
    name: 'read_note',
    groupId: 'notes',
    description: 'Reads a note',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    execute: async () => 'note text',
    ...overrides,
  }
}

function provider(tools: ChatToolDefinition[]): ChatToolProvider {
  return { id: 'test', tools: () => tools }
}

const settings = (
  groups: ProfileToolSettings['groups']
): ProfileToolSettings => ({ groups })

const context = (toolSettings?: ProfileToolSettings) => ({
  profileId: 'writer',
  modelId: 'model',
  settings: toolSettings,
})

const run = (
  set: NonNullable<
    Awaited<ReturnType<ReturnType<typeof createChatToolRegistry>['resolve']>>
  >,
  name: string,
  input: unknown
) =>
  set.tools[name].execute!(input, {
    toolCallId: 'c1',
    messages: [],
    abortSignal: new AbortController().signal,
  } as never)

describe('chat-tool-registry', () => {
  it('offers nothing without enabled groups', async () => {
    const registry = createChatToolRegistry({
      providers: () => [provider([tool()])],
      policy: createChatToolPolicy({ canAsk: true }),
    })

    expect(await registry.resolve(context())).toBeNull()
    expect(
      await registry.resolve(
        context(settings({ notes: { isEnabled: false, access: 'allow' } }))
      )
    ).toBeNull()
    expect(
      await registry.resolve(
        context(settings({ notes: { isEnabled: true, access: 'deny' } }))
      )
    ).toBeNull()
  })

  it('describes the tools of enabled groups and runs them', async () => {
    const execute = vi.fn(async () => 'note text')
    const registry = createChatToolRegistry({
      providers: () => [provider([tool({ execute })])],
      policy: createChatToolPolicy({ canAsk: true }),
    })

    const set = (await registry.resolve(
      context(settings({ notes: { isEnabled: true, access: 'allow' } }))
    ))!

    expect(Object.keys(set.tools)).toEqual(['read_note'])
    expect(set.tools.read_note.description).toBe('Reads a note')
    expect(await run(set, 'read_note', { id: 'a' })).toBe('note text')
    expect(execute).toHaveBeenCalledWith(
      { id: 'a' },
      expect.objectContaining({ toolCallId: 'c1' })
    )
  })

  it('cuts a long output and remembers the call', async () => {
    const registry = createChatToolRegistry({
      providers: () => [
        provider([
          tool({
            execute: async () => 'x'.repeat(50),
            outputLimitCharacters: 10,
          }),
        ]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve(
      context(settings({ notes: { isEnabled: true, access: 'allow' } }))
    ))!

    const output = String(await run(set, 'read_note', {}))

    expect(output.length).toBeLessThanOrEqual(10)
    expect(set.truncatedCallIds.has('c1')).toBe(true)
  })

  it('gives later calls less once the turn budget runs low', async () => {
    const limits: number[] = []
    const registry = createChatToolRegistry({
      providers: () => [
        provider([
          tool({
            execute: async (_input, { outputLimitCharacters }) => {
              limits.push(outputLimitCharacters)
              return 'x'.repeat(4_000)
            },
          }),
        ]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve({
      ...context(settings({ notes: { isEnabled: true, access: 'allow' } })),
      outputBudgetCharacters: 7_000,
    }))!

    await run(set, 'read_note', {})
    const second = String(await run(set, 'read_note', {}))
    const third = String(await run(set, 'read_note', {}))

    expect(limits).toEqual([7_000, 3_000, 0])
    expect(4000 + second.length + third.length).toBeLessThanOrEqual(7000)
    expect(second).toContain('[Output truncated')
  })

  it('reserves the budget before parallel calls and refunds unused output', async () => {
    let finish: (text: string) => void = () => {}
    const pending = new Promise<string>((resolve) => {
      finish = resolve
    })
    const limits: number[] = []
    let calls = 0
    const registry = createChatToolRegistry({
      providers: () => [
        provider([
          tool({
            outputLimitCharacters: 2000,
            execute: async (_input, { outputLimitCharacters }) => {
              limits.push(outputLimitCharacters)
              return ++calls === 1 ? pending : 'x'.repeat(2000)
            },
          }),
        ]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve({
      ...context(settings({ notes: { isEnabled: true, access: 'allow' } })),
      outputBudgetCharacters: 3000,
    }))!
    const first = run(set, 'read_note', {})
    const second = await run(set, 'read_note', {})
    finish('short')
    const firstOutput = await first
    const third = await run(set, 'read_note', {})
    expect(limits[0]).toBe(2000)
    expect(limits[1]).toBe(1000)
    expect(limits[2]).toBe(3000 - 5 - String(second).length)
    expect(
      String(firstOutput).length + String(second).length + String(third).length
    ).toBeLessThanOrEqual(3000)
  })

  it('refunds reserved output when a tool fails', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValue('ok')
    const registry = createChatToolRegistry({
      providers: () => [provider([tool({ execute })])],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve({
      ...context(settings({ notes: { isEnabled: true, access: 'allow' } })),
      outputBudgetCharacters: 100,
    }))!
    await expect(run(set, 'read_note', {})).rejects.toThrow('Failed')
    expect(await run(set, 'read_note', {})).toBe('ok')
    expect(execute.mock.calls[1][1].outputLimitCharacters).toBe(100)
  })

  it('remembers a session permission within the scope of the call', async () => {
    const policy = createChatToolPolicy({ canAsk: true })
    const registry = createChatToolRegistry({
      providers: () => [
        provider([
          tool({ approvalScope: (input) => (input as { root?: string }).root }),
        ]),
      ],
      policy,
    })
    const set = (await registry.resolve(
      context(settings({ notes: { isEnabled: true, access: 'ask' } }))
    ))!
    const decide = (input: unknown) =>
      (set.toolApproval as (options: unknown) => unknown)({
        toolCall: { toolName: 'read_note', input },
      })

    policy.answer(set.approvalKey('read_note', { root: 'a' }), 'allow-session')

    expect(decide({ root: 'a' })).toBe('approved')
    expect(decide({ root: 'b' })).toBe('user-approval')
  })

  it('collects the instructions of providers that offered a tool', async () => {
    const registry = createChatToolRegistry({
      providers: () => [
        { ...provider([tool()]), instructions: () => 'Roots: workspace/' },
        {
          id: 'off',
          tools: () => [tool({ name: 'other', groupId: 'off' })],
          instructions: () => 'Never shown',
        },
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })

    const set = (await registry.resolve(
      context(settings({ notes: { isEnabled: true, access: 'allow' } }))
    ))!

    expect(set.instructions).toBe('Roots: workspace/')
  })

  it('decides approval by the group or by the call', async () => {
    const registry = createChatToolRegistry({
      providers: () => [
        provider([
          tool(),
          tool({
            name: 'write_note',
            accessFor: (input) =>
              (input as { id?: string }).id === 'locked' ? 'deny' : undefined,
          }),
        ]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve(
      context(settings({ notes: { isEnabled: true, access: 'ask' } }))
    ))!
    const decide = (toolName: string, input: unknown) =>
      (set.toolApproval as (options: unknown) => unknown)({
        toolCall: { toolName, input },
      })

    expect(decide('read_note', {})).toBe('user-approval')
    expect(decide('write_note', { id: 'locked' })).toBe('denied')
    expect(decide('unknown', {})).toBe('denied')
  })

  it('skips tools with invalid or duplicate names', async () => {
    const warn = vi.fn()
    const registry = createChatToolRegistry({
      providers: () => [
        provider([tool(), tool(), tool({ name: 'has spaces' })]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
      warn,
    })

    const set = (await registry.resolve(
      context(settings({ notes: { isEnabled: true, access: 'allow' } }))
    ))!

    expect(Object.keys(set.tools)).toEqual(['read_note'])
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
