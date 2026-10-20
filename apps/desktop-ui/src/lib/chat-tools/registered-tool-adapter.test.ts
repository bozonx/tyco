import { describe, expect, it, vi } from 'vitest'

import type { RegisteredTool } from '../tools/tool-types'
import {
  CURRENT_TIME_TOOL,
  createDebugChatToolProvider,
  isDebugChatToolsEnabled,
  withDebugToolGroup,
} from './debug-chat-tools'
import {
  adaptRegisteredTool,
  chatToolName,
  toolResultForModel,
} from './registered-tool-adapter'

const signal = new AbortController().signal

describe('registered-tool-adapter', () => {
  it('names tools the way providers accept', () => {
    expect(chatToolName('core.copy')).toBe('core_copy')
    expect(chatToolName('my-plugin.translate text')).toBe(
      'my-plugin_translate_text'
    )
  })

  it('turns a tool result into what the model reads', () => {
    expect(toolResultForModel({ ok: true, content: 'out' })).toBe('out')
    expect(toolResultForModel({ ok: true, message: 'Copied' })).toBe('Copied')
    expect(toolResultForModel({ ok: true })).toBe('Done')
    expect(() => toolResultForModel({ ok: false, message: 'Boom' })).toThrow(
      'Boom'
    )
    expect(() => toolResultForModel({ ok: true, cancelled: true })).toThrow(
      'cancelled'
    )
  })

  it('calls the tool as a chat command with its settings', async () => {
    const run = vi.fn<RegisteredTool['run']>(async () => ({
      ok: true,
      content: 'HELLO',
    }))
    const tool: RegisteredTool = {
      id: 'text.upper',
      labelKey: 'tools.upper',
      icon: 'mdi:format-letter-case-upper',
      owner: { kind: 'core' },
      description: 'Upper-cases a text',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      baseConfig: () => ({ locale: 'en', strict: false }),
      run,
    }

    const definition = adaptRegisteredTool(tool, {
      groupId: 'commands',
      config: { strict: true },
    })

    expect(definition).toMatchObject({
      name: 'text_upper',
      groupId: 'commands',
      labelKey: 'tools.upper',
      icon: 'mdi:format-letter-case-upper',
      description: 'Upper-cases a text',
      inputSchema: tool.inputSchema,
    })
    expect(
      await definition.execute(
        { text: 'hello' },
        { signal, toolCallId: 'c1', outputLimitCharacters: 20_000 }
      )
    ).toBe('HELLO')
    expect(run).toHaveBeenCalledWith({
      input: { text: 'hello' },
      config: { locale: 'en', strict: true },
      source: 'chat',
      signal,
      isOutputRequested: true,
    })
  })
})

describe('debug-chat-tools', () => {
  it('are offered only in a development build that asks for them', () => {
    expect(
      isDebugChatToolsEnabled({ DEV: true, VITE_DEBUG_CHAT_TOOLS: 'true' })
    ).toBe(true)
    expect(
      isDebugChatToolsEnabled({ DEV: false, VITE_DEBUG_CHAT_TOOLS: 'true' })
    ).toBe(false)
    expect(isDebugChatToolsEnabled({ DEV: true })).toBe(false)
  })

  it('tell the time and fail on an unknown zone', async () => {
    const [tool] = await createDebugChatToolProvider().tools({
      profileId: null,
      modelId: 'm',
      settings: undefined,
    })
    expect(tool.name).toBe('get_current_time')
    expect(
      await tool.execute(
        { timeZone: 'UTC' },
        { signal, toolCallId: 'c1', outputLimitCharacters: 20_000 }
      )
    ).toMatch(/UTC|Coordinated Universal Time/)
    await expect(
      tool.execute(
        { timeZone: 'Mars/Olympus' },
        { signal, toolCallId: 'c2', outputLimitCharacters: 20_000 }
      )
    ).rejects.toThrow('Unknown time zone')
    expect(CURRENT_TIME_TOOL.inputSchema.type).toBe('object')
  })

  it('switch their group on, asking first', () => {
    expect(
      withDebugToolGroup({
        groups: { files: { isEnabled: true, access: 'allow' } },
      })
    ).toEqual({
      groups: {
        files: { isEnabled: true, access: 'allow' },
        debug: { isEnabled: true, access: 'ask' },
      },
    })
  })
})
