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

    expect(output.startsWith('x'.repeat(10) + '\n\n[Output truncated')).toBe(
      true
    )
    expect(set.truncatedCallIds.has('c1')).toBe(true)
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
