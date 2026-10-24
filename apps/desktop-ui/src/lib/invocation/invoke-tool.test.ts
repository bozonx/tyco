import { PluginCancellation, PluginError } from '@tyco/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

import { createToolRegistry } from '../tools/tool-registry'
import {
  NO_INPUT_SCHEMA,
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
  type ToolResult,
} from '../tools/tool-types'
import type { Invocation } from './invocation-types'
import { createToolInvoker } from './invoke-tool'

const tool = (
  run: ToolDefinition['run'] = vi.fn(async (): Promise<ToolResult> => ({
    ok: true,
    content: 'OUT',
  })),
  extra: Partial<ToolDefinition> = {}
): ToolDefinition => ({
  id: 'core.echo',
  labelKey: 'tools.echo',
  description: 'Echoes the text',
  inputSchema: TEXT_INPUT_SCHEMA,
  run,
  ...extra,
})

const invocation: Invocation = {
  toolId: 'core.echo',
  toolConfig: {},
  label: 'Echo',
}

const invokerOf = (definition: ToolDefinition) =>
  createToolInvoker({ tools: createToolRegistry([definition]) })

describe('createToolInvoker', () => {
  it('tells a missing or unavailable tool by its reason', async () => {
    const missing = createToolInvoker({ tools: createToolRegistry([]) })
    for (const options of [{}, { input: { text: 'x' } }]) {
      expect(await missing(invocation, 'x', options)).toMatchObject({
        ok: false,
        messageKey: 'toast.commandUnavailable',
        message: 'Echo',
        unavailable: 'commands.toolMissing',
      })
    }
    const run = vi.fn()
    const unavailable = invokerOf(
      tool(run, { getUnavailableReasonKey: () => 'commands.noLlm' })
    )
    expect(
      await unavailable(invocation, 'x', { input: { text: 'x' } })
    ).toMatchObject({ unavailable: 'commands.noLlm' })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs an explicit input as it is and validates it first', async () => {
    const run = vi.fn(async (): Promise<ToolResult> => ({ ok: true }))
    const invoke = invokerOf(tool(run))
    expect(
      await invoke(invocation, 'ignored', { input: { text: 'given' } })
    ).toMatchObject({ ok: true, sourceText: 'ignored' })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ input: { text: 'given' } })
    )

    run.mockClear()
    const result = await invoke(invocation, '', { input: { other: 1 } })
    expect(result).toMatchObject({ ok: false, code: 'InvalidInput' })
    expect(result.failure).toBeTruthy()
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the command and the output request to the tool', async () => {
    const run = vi.fn(async (): Promise<ToolResult> => ({ ok: true }))
    const invoke = invokerOf(tool(run))
    await invoke(
      { ...invocation, commandId: 'c-1', isOutputLogged: true },
      'text',
      { output: 'none', source: 'external' }
    )
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { text: 'text' },
        source: 'external',
        isOutputRequested: false,
        command: expect.objectContaining({
          id: 'c-1',
          name: 'Echo',
          isOutputLogged: true,
        }),
      })
    )
  })

  it('gives a tool that takes nothing no source text', async () => {
    const invoke = invokerOf(tool(undefined, { inputSchema: NO_INPUT_SCHEMA }))
    expect(await invoke(invocation, 'unused')).toMatchObject({
      ok: true,
      content: 'OUT',
      sourceText: '',
    })
  })

  it('reports a run cancelled before, during or by the tool as cancelled', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const run = vi.fn()
    expect(
      await invokerOf(tool(run))(invocation, 'x', { signal: aborted.signal })
    ).toEqual({ ok: false, cancelled: true })
    expect(run).not.toHaveBeenCalled()

    // a result that arrives after the abort is dropped
    const controller = new AbortController()
    const late = invokerOf(
      tool(async () => {
        controller.abort()
        return { ok: true, content: 'partial' }
      })
    )
    expect(await late(invocation, 'x', { signal: controller.signal })).toEqual({
      ok: false,
      cancelled: true,
    })

    const byTool = invokerOf(
      tool(async () => {
        throw new PluginCancellation('stopped')
      })
    )
    expect(await byTool(invocation, 'x')).toEqual({
      ok: false,
      cancelled: true,
    })
  })

  it('turns thrown errors into failures with a reason for the log', async () => {
    const plugin = invokerOf(
      tool(async () => {
        throw new PluginError('plugin.quotaExceeded')
      })
    )
    expect(await plugin(invocation, 'x')).toEqual({
      ok: false,
      messageKey: 'plugin.quotaExceeded',
      failure: 'plugin.quotaExceeded',
    })

    const crash = invokerOf(
      tool(async () => {
        throw new Error('boom')
      })
    )
    expect(await crash(invocation, 'x')).toEqual({
      ok: false,
      messageKey: 'toast.commandFailed',
      message: 'boom',
      failure: 'boom',
    })
  })
})
