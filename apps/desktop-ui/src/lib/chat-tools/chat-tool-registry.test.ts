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
    source: { kind: 'plugin', id: 'notes' },
    risk: 'read',
    description: 'Reads a note',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    execute: async () => 'note text',
    ...overrides,
  }
}

function provider(tools: ChatToolDefinition[]): ChatToolProvider {
  return { id: 'test', tools: () => tools }
}

/** The settings of a plugin source as the old groups put them */
const settings = (
  groups: Record<
    string,
    { isEnabled: boolean; access: 'ask' | 'allow' | 'deny' }
  >
): ProfileToolSettings => {
  const result: ProfileToolSettings = {
    sources: { 'plugin:off': { isEnabled: false } },
    tools: {},
    commandIds: [],
  }
  for (const [id, group] of Object.entries(groups)) {
    if (!group.isEnabled || group.access === 'deny')
      result.sources[`plugin:${id}`] = { isEnabled: false }
    if (group.access === 'ask')
      for (const name of ['read_note', 'write_note'])
        result.tools[`plugin:${id}:${name}`] = 'ask'
  }
  return result
}

const context = (
  toolSettings: ProfileToolSettings = settings({
    notes: { isEnabled: false, access: 'allow' },
  })
) => ({
  profileId: 'writer',
  modelId: 'model',
  scope: {
    kind: 'profile' as const,
    profileId: 'writer',
    settings: toolSettings,
    catalog: undefined,
  },
  callContext: { kind: 'profile' as const, profileId: 'writer' },
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

  it('blocks a queued call after its source is disabled', async () => {
    const execute = vi.fn(async () => 'note text')
    const registry = createChatToolRegistry({
      providers: () => [provider([tool({ execute })])],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const initial = context(settings({}))
    let scope = initial.scope
    const set = (await registry.resolve({
      ...initial,
      getCurrentScope: () => scope,
    }))!
    scope = context().scope
    await expect(run(set, 'read_note', {})).rejects.toThrow(
      /permissions changed/
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('blocks an automatic memory update queued before an external read in the same step', async () => {
    const execute = vi.fn(async () => 'saved')
    const registry = createChatToolRegistry({
      providers: () => [
        provider([
          tool({ name: 'remember', asksAfterUntrustedContent: true, execute }),
          tool({ name: 'read_page', givesUntrustedContent: true }),
        ]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve(context(settings({}))))!
    const decide = set.toolApproval as (options: unknown) => unknown
    expect(
      decide({
        toolCall: { toolName: 'remember', toolCallId: 'c1', input: {} },
      })
    ).toBe('approved')
    expect(
      decide({
        toolCall: { toolName: 'read_page', toolCallId: 'c2', input: {} },
      })
    ).toBe('approved')
    await expect(run(set, 'remember', {})).rejects.toThrow(/requires approval/)
    expect(execute).not.toHaveBeenCalled()
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

    expect(limits).toEqual([7_000, 3_000, 2_000])
    expect(second).toContain('[Output truncated')
    expect(third).toContain('[Output truncated')
  })

  it('guarantees at least MIN_TOOL_OUTPUT_CHARACTERS even when budget is depleted', async () => {
    const limits: number[] = []
    const registry = createChatToolRegistry({
      providers: () => [
        provider([
          tool({
            execute: async (_input, { outputLimitCharacters }) => {
              limits.push(outputLimitCharacters)
              return 'ok'
            },
          }),
        ]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve({
      ...context(settings({ notes: { isEnabled: true, access: 'allow' } })),
      outputBudgetCharacters: 0,
    }))!

    await run(set, 'read_note', {})
    expect(limits[0]).toBe(2_000)
  })

  it('respects a tool limit that is smaller than the minimum', async () => {
    const limits: number[] = []
    const registry = createChatToolRegistry({
      providers: () => [
        provider([
          tool({
            outputLimitCharacters: 500,
            execute: async (_input, { outputLimitCharacters }) => {
              limits.push(outputLimitCharacters)
              return 'ok'
            },
          }),
        ]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve({
      ...context(settings({ notes: { isEnabled: true, access: 'allow' } })),
      outputBudgetCharacters: 0,
    }))!

    await run(set, 'read_note', {})
    expect(limits[0]).toBe(500)
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
            outputLimitCharacters: 3000,
            execute: async (_input, { outputLimitCharacters }) => {
              limits.push(outputLimitCharacters)
              return ++calls === 1 ? pending : 'x'.repeat(1500)
            },
          }),
        ]),
      ],
      policy: createChatToolPolicy({ canAsk: true }),
    })
    const set = (await registry.resolve({
      ...context(settings({ notes: { isEnabled: true, access: 'allow' } })),
      outputBudgetCharacters: 5000,
    }))!
    const first = run(set, 'read_note', {})
    const second = await run(set, 'read_note', {})
    finish('short')
    const firstOutput = await first
    const third = await run(set, 'read_note', {})
    expect(limits[0]).toBe(3000)
    expect(limits[1]).toBe(2000)
    expect(limits[2]).toBe(3000)
    expect(firstOutput).toBe('short')
    expect(String(second)).toBe('x'.repeat(1500))
    expect(String(third)).toBe('x'.repeat(1500))
  })

  it('refunds reserved output when a tool fails', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValue('ok')
    const registry = createChatToolRegistry({
      providers: () => [
        provider([tool({ outputLimitCharacters: 100, execute })]),
      ],
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
          tools: () => [
            tool({ name: 'other', source: { kind: 'plugin', id: 'off' } }),
          ],
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
