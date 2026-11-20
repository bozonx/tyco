import { PluginCancellation, PluginError } from '@tyco/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

import { createOperationRegistry } from '../operations/operation-registry'
import {
  NO_INPUT_SCHEMA,
  TEXT_INPUT_SCHEMA,
  type OperationDefinition,
  type OperationResult,
} from '../operations/operation-types'
import type { Invocation } from './invocation-types'
import { createOperationInvoker } from './invoke-operation'

const tool = (
  run: OperationDefinition['run'] = vi.fn(
    async (): Promise<OperationResult> => ({ ok: true, content: 'OUT' })
  ),
  extra: Partial<OperationDefinition> = {}
): OperationDefinition => ({
  id: 'core.echo',
  labelKey: 'operations.echo',
  description: 'Echoes the text',
  inputSchema: TEXT_INPUT_SCHEMA,
  run,
  ...extra,
})

const invocation: Invocation = {
  operationId: 'core.echo',
  operationConfig: {},
  label: 'Echo',
}

const invokerOf = (definition: OperationDefinition) =>
  createOperationInvoker({ operations: createOperationRegistry([definition]) })

describe('createOperationInvoker', () => {
  it('tells a missing or unavailable tool by its reason', async () => {
    const missing = createOperationInvoker({
      operations: createOperationRegistry([]),
    })
    for (const options of [{}, { input: { text: 'x' } }]) {
      expect(await missing(invocation, 'x', options)).toMatchObject({
        ok: false,
        messageKey: 'toast.commandUnavailable',
        message: 'Echo',
        unavailable: 'commands.typeMissing',
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

  it('refuses a command of another platform or with a variable not set here', async () => {
    const run = vi.fn(async (): Promise<OperationResult> => ({ ok: true }))
    const registry = createOperationRegistry([tool(run, { id: 'webhook' })])
    const invoke = createOperationInvoker({
      operations: {
        get: registry.get,
        environment: () => ({
          platform: 'linux',
          variables: { HOOKS: 'https://hooks.example' },
        }),
      },
    })
    const webhook: Invocation = {
      operationId: 'webhook',
      operationConfig: { url: '{{var:HOOKS}}/{{var:PATH}}' },
      label: 'Hook',
    }
    expect(
      await invoke({ ...webhook, platforms: ['windows'] }, 'x')
    ).toMatchObject({ unavailable: 'commands.otherPlatform' })
    // an explicit input, e.g. of an agent or `--input-json`, is no way round
    expect(
      await invoke({ ...webhook, platforms: ['windows'] }, '', {
        input: { text: 'x' },
      })
    ).toMatchObject({ unavailable: 'commands.otherPlatform' })
    expect(await invoke(webhook, '', { input: { text: 'x' } })).toMatchObject({
      unavailable: 'commands.variablesNotSet',
    })
    expect(await invoke(webhook, 'x')).toMatchObject({
      ok: false,
      messageKey: 'toast.variablesNotSet',
      message: 'PATH',
      unavailable: 'commands.variablesNotSet',
    })
    expect(run).not.toHaveBeenCalled()
    await invoke(
      {
        ...webhook,
        operationConfig: { url: '{{var:HOOKS}}/x' },
        platforms: ['linux'],
      },
      'x'
    )
    expect(run).toHaveBeenCalled()
  })

  it('refuses a note-writing tool without a notes folder on this device', async () => {
    const run = vi.fn(async (): Promise<OperationResult> => ({ ok: true }))
    const notes = tool(run, {
      directoryFieldName: 'pathToNotes',
      configFields: [{ name: 'pathToNotes', type: 'text', defaultValue: '' }],
    })
    const invoke = invokerOf(notes)
    expect(await invoke(invocation, 'x')).toMatchObject({
      unavailable: 'commands.notesFolderMissing',
    })
    expect(run).not.toHaveBeenCalled()
    await invoke(
      { ...invocation, operationConfig: { pathToNotes: '/notes' } },
      'x'
    )
    expect(run).toHaveBeenCalled()
    // a tool of the same plugin that writes no notes is not held up
    const other = vi.fn(async (): Promise<OperationResult> => ({ ok: true }))
    await invokerOf(tool(other, { directoryFieldName: 'pathToNotes' }))(
      invocation,
      'x'
    )
    expect(other).toHaveBeenCalled()
  })

  it('runs an explicit input as it is and validates it first', async () => {
    const run = vi.fn(async (): Promise<OperationResult> => ({ ok: true }))
    const invoke = invokerOf(tool(run))
    expect(
      await invoke(invocation, 'ignored', { input: { text: 'given' } })
    ).toMatchObject({ ok: true, sourceText: 'ignored' })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ input: { text: 'given' } })
    )

    run.mockClear()
    // a structured input needs no parser when it is given whole
    const structured = vi.fn(async (): Promise<OperationResult> => ({
      ok: true,
    }))
    const structuredInvoke = invokerOf(
      tool(structured, {
        inputSchema: {
          type: 'object',
          properties: { at: { type: 'string' }, message: { type: 'string' } },
          required: ['at'],
        },
      })
    )
    expect(await structuredInvoke(invocation, 'x')).toMatchObject({
      unavailable: 'commands.inputUnsupported',
    })
    expect(
      await structuredInvoke(invocation, '', { input: { at: '18:00' } })
    ).toMatchObject({ ok: true })
    expect(structured).toHaveBeenCalled()

    const result = await invoke(invocation, '', { input: { other: 1 } })
    expect(result).toMatchObject({ ok: false, code: 'InvalidInput' })
    expect(result.failure).toBeTruthy()
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the command and the output request to the tool', async () => {
    const run = vi.fn(async (): Promise<OperationResult> => ({ ok: true }))
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

  it('reports a change a tool committed while it was cancelled, without its output', async () => {
    const controller = new AbortController()
    const committed = invokerOf(
      tool(async () => {
        controller.abort()
        return { ok: true, isCommitted: true, content: 'partial' }
      })
    )
    expect(
      await committed(invocation, 'x', { signal: controller.signal })
    ).toEqual({ ok: true, isCommitted: true, sourceText: '' })
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
