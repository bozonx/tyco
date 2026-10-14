import { describe, expect, it, vi } from 'vitest'

import {
  type CommandConfig,
  type CommandRunEvent,
  DEFAULT_USER_CONFIG,
} from '@tyco/shared'

import { createCommand } from './command-config'
import type { InvocationOutcome } from '../invocation/invocation-types'
import {
  type ExternalRunDependencies,
  type RunReport,
  createExternalRun,
} from './external-run'

const lamp: CommandConfig = {
  ...createCommand('webhook', 'lamp'),
  name: 'Lamp',
  toolConfig: { url: 'https://x.test' },
}

const event = (extra: Partial<CommandRunEvent> = {}): CommandRunEvent => ({
  commandId: 'lamp',
  userConfig: { ...DEFAULT_USER_CONFIG, commands: [lamp] },
  ...extra,
})

function setup(
  run: (
    command: CommandConfig,
    text: string,
    report: RunReport
  ) => Promise<InvocationOutcome>
) {
  const deps = {
    run: vi.fn(run),
    showOverlay: vi.fn(),
    notify: vi.fn(),
    applyUserConfig: vi.fn(),
    logRun: vi.fn(),
    saveOutput: vi.fn(async () => {}),
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  } satisfies ExternalRunDependencies
  return { deps, external: createExternalRun(deps) }
}

describe('createExternalRun', () => {
  it('runs the command of the event and shows how it went', async () => {
    const { deps, external } = setup(async (_command, _text, report) => {
      report('success', 'done')
      return { success: true, result: undefined }
    })
    const outcome = await external.handleRun(event())

    expect(outcome).toEqual({ success: true, result: undefined })
    expect(deps.applyUserConfig).toHaveBeenCalled()
    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lamp' }),
      '',
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(deps.showOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'success', text: 'Lamp: done' })
    )
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.saveOutput).not.toHaveBeenCalled()
    expect(deps.logRun).toHaveBeenCalledWith({
      commandId: 'lamp',
      name: 'Lamp',
      source: 'external',
      success: true,
    })
  })

  it('passes the text on and keeps it in the history', async () => {
    const { deps, external } = setup(async () => ({
      success: true,
      result: undefined,
    }))
    await external.handleRun(event({ text: 'buy milk' }))
    expect(deps.run).toHaveBeenCalledWith(
      expect.anything(),
      'buy milk',
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(deps.saveOutput).toHaveBeenCalledWith('buy milk')
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'buy milk' })
    )
    // nothing was reported: the pending bubble goes away
    expect(deps.showOverlay).toHaveBeenLastCalledWith(null)
  })

  it('reports a failure in the bubble and a desktop notification', async () => {
    const { deps, external } = setup(async (_command, _text, report) => {
      report('error', 'HTTP 500')
      return { success: false, message: 'HTTP 500' }
    })
    await external.handleRun(event())
    expect(deps.showOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'error', text: 'Lamp: HTTP 500' })
    )
    expect(deps.notify).toHaveBeenCalledWith(
      'externalCommand.failed {"name":"Lamp"}',
      'HTTP 500'
    )
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'HTTP 500' })
    )
  })

  it('reports a run that threw', async () => {
    const { deps, external } = setup(() => Promise.reject(new Error('boom')))
    const outcome = await external.handleRun(event())
    expect(outcome).toEqual({ success: false, message: 'boom' })
    expect(deps.notify).toHaveBeenCalledWith(expect.any(String), 'boom')
  })

  it('reports a command gone from the library', async () => {
    const { deps, external } = setup(async () => ({
      success: true,
      result: undefined,
    }))
    const outcome = await external.handleRun(event({ commandId: 'gone' }))
    expect(outcome.success).toBe(false)
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.notify).toHaveBeenCalledWith(
      'externalCommand.failed {"name":"gone"}',
      'externalCommand.missing'
    )
  })
})

describe('external jobs', () => {
  it('does not execute a cancelled or denied job', async () => {
    const { deps } = setup(async () => ({ success: true, result: undefined }))
    const finishJob = vi.fn(async () => {})
    const external = createExternalRun({
      ...deps,
      claimJob: async () => false,
      finishJob,
    })
    const outcome = await external.handleRun(event({ jobId: 'denied' }))
    expect(outcome.cancelled).toBe(true)
    expect(deps.run).not.toHaveBeenCalled()
    expect(finishJob).not.toHaveBeenCalled()
  })

  it('aborts a running job and cannot publish its late success', async () => {
    const { deps } = setup(async () => ({ success: true, result: undefined }))
    let finishRun!: () => void
    const finishJob = vi.fn(async () => {})
    const run = vi.fn<ExternalRunDependencies['run']>(
      async (_command, _text, _report, options) => {
        await new Promise<void>((resolve) => {
          finishRun = resolve
        })
        expect(options?.signal?.aborted).toBe(true)
        return { success: true, output: 'late' }
      }
    )
    const external = createExternalRun({
      ...deps,
      run,
      claimJob: async () => true,
      finishJob,
    })
    const pending = external.handleRun(event({ jobId: 'running' }))
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    external.handleCancel('running')
    finishRun()
    expect((await pending).cancelled).toBe(true)
    expect(finishJob).toHaveBeenCalledWith(
      'running',
      expect.objectContaining({ success: false, cancelled: true })
    )
  })
})

it('reports a failed replacement instead of publishing the tool success', async () => {
  const { deps } = setup(async () => ({ success: true, output: 'result' }))
  const external = createExternalRun({
    ...deps,
    claimJob: async () => true,
    finishJob: async () => ({
      success: false,
      message: 'Focus changed',
      code: 'SelectionFailed',
      output: 'result',
    }),
  })
  const outcome = await external.handleRun(event({ jobId: 'selection' }))
  expect(outcome.success).toBe(false)
  expect(outcome.output).toBe('result')
  expect(deps.notify).toHaveBeenCalledWith(expect.any(String), 'Focus changed')
  expect(deps.logRun).toHaveBeenCalledWith(
    expect.objectContaining({ success: false, message: 'Focus changed' })
  )
})

describe('external run disposal', () => {
  it('finishes a claimed job once and suppresses late reports', async () => {
    let resolve!: (outcome: InvocationOutcome) => void
    let report!: RunReport
    let signal: AbortSignal | undefined
    const finishJob = vi.fn(async () => {})
    const showOverlay = vi.fn()
    const logRun = vi.fn()
    const model = createExternalRun({
      run: async (_command, _text, reporting, options) => {
        report = reporting
        signal = options?.signal
        return new Promise((done) => {
          resolve = done
        })
      },
      claimJob: async () => true,
      finishJob,
      showOverlay,
      logRun,
      notify: vi.fn(),
      t: (key) => key,
    })
    const pending = model.handleRun(event({ jobId: 'job' }))
    await vi.waitFor(() => expect(signal).toBeDefined())
    model.dispose()
    model.dispose()
    expect(signal?.aborted).toBe(true)
    expect(finishJob).toHaveBeenCalledExactlyOnceWith('job', {
      success: false,
      cancelled: true,
    })
    showOverlay.mockClear()
    report('success', 'late report')
    resolve({ success: true })
    expect(await pending).toMatchObject({ cancelled: true })
    expect(finishJob).toHaveBeenCalledOnce()
    expect(showOverlay).not.toHaveBeenCalled()
    expect(logRun).not.toHaveBeenCalled()
  })

  it('returns a job claimed after disposal without executing it', async () => {
    let claim!: (value: boolean) => void
    const finishJob = vi.fn(async () => {})
    const run = vi.fn(async () => ({ success: true }))
    const model = createExternalRun({
      run,
      claimJob: () =>
        new Promise((resolve) => {
          claim = resolve
        }),
      finishJob,
      showOverlay: vi.fn(),
      notify: vi.fn(),
      t: (key) => key,
    })
    const pending = model.handleRun(event({ jobId: 'job' }))
    model.dispose()
    claim(true)
    expect(await pending).toMatchObject({ cancelled: true })
    expect(run).not.toHaveBeenCalled()
    expect(finishJob).toHaveBeenCalledOnce()
  })
})

describe('cancellation before external execution', () => {
  it('clears the pending overlay if cancelled while history is being saved', async () => {
    let saved!: () => void
    const run = vi.fn(async () => ({ success: true }))
    const showOverlay = vi.fn()
    const finishJob = vi.fn(async () => {})
    const model = createExternalRun({
      run,
      showOverlay,
      finishJob,
      claimJob: async () => true,
      saveOutput: () =>
        new Promise<void>((resolve) => {
          saved = resolve
        }),
      notify: vi.fn(),
      t: (key) => key,
    })
    const pending = model.handleRun(event({ jobId: 'job', text: 'Input' }))
    await vi.waitFor(() => expect(saved).toBeDefined())
    model.handleCancel('job')
    saved()
    expect(await pending).toMatchObject({ cancelled: true })
    expect(showOverlay).toHaveBeenLastCalledWith(null)
    expect(run).not.toHaveBeenCalled()
    expect(finishJob).toHaveBeenCalledOnce()
    model.dispose()
  })
})
