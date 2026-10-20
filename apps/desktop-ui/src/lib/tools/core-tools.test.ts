import { errorMessage } from '@tyco/shared/value-guards'
import { describe, expect, it, vi } from 'vitest'

import {
  type CoreToolDependencies,
  type TranslateOptions,
  createCoreTools,
} from './core-tools'
import type { ToolCall, ToolDefinition } from './tool-types'

function setup(extra: Partial<CoreToolDependencies> = {}) {
  const deps: CoreToolDependencies = {
    insertText: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
    askInChat: vi.fn(async () => {}),
    correctText: vi.fn(async (text: string) => `fixed ${text}`),
    translateTo: vi.fn(
      async (language: string, text: string, _options: TranslateOptions) => ({
        text: `${language}: ${text}`,
      })
    ),
    aiCustomPrompt: vi.fn(
      async (prompt: string, text: string) => `${prompt} → ${text}`
    ),
    getLlmUnavailableReasonKey: vi.fn(() => undefined),
    getTranslatorUnavailableReasonKey: vi.fn(() => undefined),
    describeError: (error) => errorMessage(error),
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
      isOutputRequested: true,
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
    expect(tools.get('core.correct')?.defaultOutputAction).toBe(
      'insertIntoWindow'
    )
    expect(tools.get('core.copy')?.defaultOutputAction).toBeUndefined()
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
      messageKey: 'common.copied',
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

  it('passes the source language and the stages to the translator', async () => {
    const { deps, tools } = setup()
    vi.mocked(deps.translateTo).mockImplementation(
      async (language, text, options) => {
        options.onStage?.('checking')
        return { text: `${language}: ${text}`, meta: { provider: 'deepl' } }
      }
    )
    const onProgress = vi.fn()
    const signal = new AbortController().signal
    const result = await tools
      .get('core.translate')!
      .run({
        input: { text: 'hola' },
        config: { language: 'en_US', sourceLanguage: 'es_AR' },
        source: 'menu',
        signal,
        isOutputRequested: true,
        onProgress,
      })
    expect(result).toEqual({
      ok: true,
      content: 'en_US: hola',
      meta: { provider: 'deepl' },
    })
    expect(deps.translateTo).toHaveBeenCalledWith('en_US', 'hola', {
      signal,
      sourceLanguage: 'es_AR',
      onStage: onProgress,
    })
    expect(onProgress).toHaveBeenCalledWith('checking')
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
      getLlmUnavailableReasonKey: (task) =>
        task === 'aiTask' ? 'tools.noLlm' : undefined,
      getTranslatorUnavailableReasonKey: () => 'tools.noLlm',
    })
    expect(
      tools.get('core.correct')?.getUnavailableReasonKey?.()
    ).toBeUndefined()
    expect(tools.get('core.aiTask')?.getUnavailableReasonKey?.()).toBe(
      'tools.noLlm'
    )
    expect(tools.get('core.translate')?.getUnavailableReasonKey?.()).toBe(
      'tools.noLlm'
    )
    expect(tools.get('core.copy')?.getUnavailableReasonKey).toBeUndefined()
  })
})
