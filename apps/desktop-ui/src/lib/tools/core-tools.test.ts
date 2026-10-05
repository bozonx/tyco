import { describe, expect, it, vi } from 'vitest'

import { type CoreToolDependencies, createCoreTools } from './core-tools'
import type { ToolCall, ToolDefinition } from './tool-types'

function setup(extra: Partial<CoreToolDependencies> = {}) {
  const deps: CoreToolDependencies = {
    insertText: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
    askInChat: vi.fn(async () => {}),
    correctText: vi.fn(async (text: string) => `fixed ${text}`),
    translateTo: vi.fn(
      async (language: string, text: string) => `${language}: ${text}`
    ),
    aiCustomPrompt: vi.fn(
      async (prompt: string, text: string) => `${prompt} → ${text}`
    ),
    llmUnavailable: vi.fn(() => undefined),
    translatorUnavailable: vi.fn(() => undefined),
    describeError: (error) =>
      error instanceof Error ? error.message : String(error),
    ...extra,
  }
  const tools = new Map(
    createCoreTools(deps).map((tool): [string, ToolDefinition] => [
      tool.id,
      tool,
    ])
  )
  const run = (
    id: string,
    text: string,
    config: Record<string, unknown> = {},
    signal = new AbortController().signal
  ) => {
    const call: ToolCall = {
      input: { text },
      config,
      source: 'launcher',
      signal,
      wantsOutput: true,
    }
    return tools.get(id)!.run(call)
  }
  return { deps, tools, run }
}

describe('createCoreTools', () => {
  it('offers the tools of the app, those of the LLM replacing the selection', () => {
    const { tools } = setup()
    expect([...tools.keys()]).toEqual([
      'core.insert',
      'core.copy',
      'core.correct',
      'core.translate',
      'core.aiTask',
      'core.askInChat',
    ])
    expect(tools.get('core.correct')?.defaultAfterRun).toBe('replaceSelection')
    expect(tools.get('core.copy')?.defaultAfterRun).toBeUndefined()
  })

  it('inserts, copies and asks in the chat', async () => {
    const { deps, run } = setup()
    expect(await run('core.insert', 'hi')).toEqual({
      ok: true,
      keepWindow: true,
    })
    expect(deps.insertText).toHaveBeenCalledWith('hi')
    expect(await run('core.copy', 'hi')).toEqual({
      ok: true,
      messageKey: 'toast.copied',
    })
    expect(deps.copyText).toHaveBeenCalledWith('hi')
    await run('core.askInChat', 'why?')
    expect(deps.askInChat).toHaveBeenCalledWith('why?')
  })

  it('refuses an empty text', async () => {
    const { deps, run } = setup()
    expect(await run('core.insert', '  ')).toMatchObject({
      ok: false,
      messageKey: 'toast.textNotSelected',
    })
    expect(await run('core.correct', '')).toMatchObject({ ok: false })
    expect(deps.insertText).not.toHaveBeenCalled()
    expect(deps.correctText).not.toHaveBeenCalled()
  })

  it('returns the text the LLM made of the input', async () => {
    const { run } = setup()
    expect(await run('core.correct', 'teh')).toEqual({
      ok: true,
      content: 'fixed teh',
    })
    expect(await run('core.translate', 'hola', { language: 'en_US' })).toEqual({
      ok: true,
      content: 'en_US: hola',
    })
    expect(await run('core.aiTask', 'text', { prompt: ' Shorter ' })).toEqual({
      ok: true,
      content: 'Shorter → text',
    })
  })

  it('needs the language and the instruction of the command', async () => {
    const { deps, run } = setup()
    expect(await run('core.translate', 'hola')).toEqual({
      ok: false,
      messageKey: 'commands.errorNoLanguage',
    })
    expect(await run('core.aiTask', 'text', { prompt: ' ' })).toEqual({
      ok: false,
      messageKey: 'commands.errorNoPrompt',
    })
    expect(deps.translateTo).not.toHaveBeenCalled()
  })

  it('reports a failure of the LLM and an empty answer', async () => {
    const { run } = setup({
      correctText: async () => {
        throw new Error('Rate limit')
      },
      aiCustomPrompt: async () => ' ',
    })
    expect(await run('core.correct', 'x')).toEqual({
      ok: false,
      message: 'Rate limit',
    })
    expect(await run('core.aiTask', 'x', { prompt: 'p' })).toEqual({
      ok: false,
      messageKey: 'selection.emptyResult',
    })
  })

  it('reports a cancelled request as cancelled', async () => {
    const controller = new AbortController()
    const { run } = setup({
      correctText: async () => {
        controller.abort()
        throw new Error('aborted')
      },
    })
    expect(await run('core.correct', 'x', {}, controller.signal)).toEqual({
      ok: false,
      cancelled: true,
    })
  })

  it('tells why a tool of the LLM cannot run', () => {
    const { tools } = setup({
      llmUnavailable: (task) =>
        task === 'aiTasks' ? 'tools.noLlm' : undefined,
      translatorUnavailable: () => 'tools.noLlm',
    })
    expect(tools.get('core.correct')?.unavailableReason?.()).toBeUndefined()
    expect(tools.get('core.aiTask')?.unavailableReason?.()).toBe('tools.noLlm')
    expect(tools.get('core.translate')?.unavailableReason?.()).toBe(
      'tools.noLlm'
    )
    expect(tools.get('core.copy')?.unavailableReason).toBeUndefined()
  })
})
