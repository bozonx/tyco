import { describe, expect, it, vi } from 'vitest'

import {
  type CommandConfig,
  type CommandRunPayload,
  type CommandRunRequest,
  DEFAULT_USER_CONFIG,
} from '@tyco/shared'

import type { InvocationOutcome } from '../invocation/invocation-types'
import { createCommand } from './command-config'
import {
  type CommandRunHooks,
  type CommandRunSessionDependencies,
  createCommandRunSession,
} from './command-run-session'

const lamp: CommandConfig = {
  ...createCommand('webhook', 'lamp'),
  name: 'Lamp',
  operationConfig: { url: 'https://x.test' },
}

const request = (
  extra: Partial<CommandRunRequest> = {}
): CommandRunRequest => ({
  jobId: 'job',
  commandId: 'lamp',
  commandName: 'Lamp',
  needsAccess: false,
  replace: false,
  isExternal: true,
  ...extra,
})

const payload = (
  extra: Partial<CommandRunPayload> = {}
): CommandRunPayload => ({
  commandId: 'lamp',
  text: 'source',
  userConfig: {
    ...DEFAULT_USER_CONFIG,
    commands: [lamp],
    commandRunTimeoutSec: 45,
  },
  ...extra,
})

type Run = (
  command: CommandConfig,
  text: string,
  hooks: CommandRunHooks,
  options: { signal?: AbortSignal }
) => Promise<InvocationOutcome>

function setup(
  run: Run = async () => ({ success: true, output: 'result' }),
  extra: Partial<CommandRunSessionDependencies> = {}
) {
  const runMock = vi.fn(run)
  const deps = {
    claim: vi.fn(async () => payload()),
    answerAccess: vi.fn(async () => {}),
    finish: vi.fn(async () => undefined),
    cancelJob: vi.fn(async () => {}),
    run: runMock,
    takesText: vi.fn(() => true),
    hide: vi.fn(),
    applyUserConfig: vi.fn(),
    logRun: vi.fn(),
    reportError: vi.fn(),
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    ...extra,
  } satisfies CommandRunSessionDependencies
  return { deps, runMock, session: createCommandRunSession(deps) }
}

/** Lets the promises the session chains settle */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createCommandRunSession', () => {
  it('runs the job and shows its result', async () => {
    const { deps, runMock, session } = setup()
    await session.open(request())
    expect(deps.claim).toHaveBeenCalledWith('job')
    expect(deps.applyUserConfig).toHaveBeenCalled()
    expect(runMock.mock.calls[0]?.[1]).toBe('source')
    expect(runMock.mock.calls[0]?.[3]).toMatchObject({ source: 'external' })
    expect(deps.finish).toHaveBeenCalledWith('job', {
      success: true,
      output: 'result',
    })
    expect(session.state.value).toMatchObject({
      phase: 'result',
      output: 'result',
      commandName: 'Lamp',
    })
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'lamp', source: 'external' })
    )
    expect(session.isActive()).toBe(false)
  })

  it('shows a failed execution', async () => {
    const { session } = setup(async () => ({ success: false, message: 'boom' }))
    await session.open(request())
    await flush()
    expect(session.state.value.phase).toBe('failed')
  })

  it('asks for the text a command takes when the run brought none', async () => {
    const supplyInput = vi.fn(async () => {})
    const { runMock, session } = setup(undefined, {
      claim: vi.fn(async () => payload({ text: undefined })),
      supplyInput,
    })
    void session.open(request({ isExternal: false }))
    await flush()
    expect(session.state.value.phase).toBe('input')
    expect(runMock).not.toHaveBeenCalled()
    await session.submitText('typed')
    expect(supplyInput).toHaveBeenCalledExactlyOnceWith('job', 'typed')
    expect(supplyInput).toHaveBeenCalledBefore(runMock)
    expect(runMock.mock.calls[0]?.[1]).toBe('typed')
    expect(runMock.mock.calls[0]?.[3]).toMatchObject({ source: 'menu' })
    expect(session.state.value.phase).toBe('result')
  })

  it('asks for access first and runs once it is allowed', async () => {
    const { deps, session } = setup()
    void session.open(request({ needsAccess: true }))
    expect(session.state.value.phase).toBe('access')
    expect(deps.claim).not.toHaveBeenCalled()
    await session.respondAccess('once')
    // a second answer is not sent
    await session.respondAccess('deny')
    expect(deps.answerAccess).toHaveBeenCalledExactlyOnceWith('job', 'once')
    expect(session.state.value.phase).toBe('result')
  })

  it('hides without running when access is denied', async () => {
    const { deps, session } = setup()
    void session.open(request({ needsAccess: true }))
    await session.respondAccess('deny')
    expect(deps.answerAccess).toHaveBeenCalledWith('job', 'deny')
    expect(deps.hide).toHaveBeenCalled()
    expect(deps.claim).not.toHaveBeenCalled()
    expect(session.state.value.phase).toBe('cancelled')
  })

  it('cancels a running command explicitly and hides the overlay', async () => {
    let started!: () => void
    const isStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const { deps, session } = setup(
      (_command, _text, _hooks, options) =>
        new Promise((resolve) => {
          started()
          options.signal?.addEventListener('abort', () =>
            resolve({ success: false, cancelled: true })
          )
        })
    )
    const settled = session.open(request())
    await isStarted
    expect(session.isActive()).toBe(true)
    await session.cancel()
    await settled
    expect(deps.hide).toHaveBeenCalled()
    expect(deps.cancelJob).toHaveBeenCalledWith('job')
    expect(deps.finish).toHaveBeenCalledWith(
      'job',
      expect.objectContaining({ cancelled: true })
    )
    expect(deps.logRun).not.toHaveBeenCalled()
    expect(session.isActive()).toBe(false)
  })

  it('tells a run the backend stopped over its limit', async () => {
    let started!: () => void
    const isStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const { deps, session } = setup(
      (_command, _text, _hooks, options) =>
        new Promise((resolve) => {
          started()
          options.signal?.addEventListener('abort', () =>
            resolve({ success: false, cancelled: true })
          )
        }),
      {
        finish: vi.fn(async () => ({
          success: false,
          cancelled: true,
          code: 'TimedOut',
        })),
      }
    )
    const settled = session.open(request())
    await isStarted
    session.handleJobCancelled('other')
    expect(session.isActive()).toBe(true)
    session.handleJobCancelled('job')
    await settled
    expect(session.state.value).toMatchObject({
      phase: 'failed',
      message: 'commandRun.timedOut {"seconds":"45"}',
    })
    expect(deps.hide).not.toHaveBeenCalled()
  })

  it('shows what the run reported when it failed', async () => {
    const { session } = setup(async (_command, _text, hooks) => {
      hooks.report('error', 'Server said no')
      return { success: false, message: 'HTTP 500' }
    })
    await session.open(request())
    expect(session.state.value).toMatchObject({
      phase: 'failed',
      message: 'Server said no',
    })
  })

  it('shows the output the command meant for its menu', async () => {
    const { deps, session } = setup(async (_command, _text, hooks) => {
      hooks.showResult('menu output', 'source')
      return { success: true }
    })
    await session.open(request({ isExternal: false }))
    expect(session.state.value).toMatchObject({
      phase: 'result',
      output: 'menu output',
      sourceText: 'source',
    })
    expect(deps.hide).not.toHaveBeenCalled()
  })

  it('hides once the output went where the command sends it', async () => {
    const { deps, session } = setup(async () => ({ success: true }))
    await session.open(request({ isExternal: false }))
    expect(deps.hide).toHaveBeenCalled()
  })

  it('fails a job whose command is gone', async () => {
    const { deps, runMock, session } = setup(undefined, {
      claim: vi.fn(async () => payload({ commandId: 'missing' })),
    })
    await session.open(request())
    expect(runMock).not.toHaveBeenCalled()
    expect(deps.finish).toHaveBeenCalledWith('job', {
      success: false,
      message: 'commandRun.missing',
    })
    expect(session.state.value.phase).toBe('failed')
  })

  it('fails without running when the job may not run any more', async () => {
    const { runMock, session } = setup(undefined, {
      claim: vi.fn(async () => null),
    })
    await session.open(request())
    expect(runMock).not.toHaveBeenCalled()
    expect(session.state.value).toMatchObject({
      phase: 'failed',
      message: 'commandRun.unavailable',
    })
  })

  it('ends a run that waits for its text when the overlay is left', async () => {
    const { deps, session } = setup(undefined, {
      claim: vi.fn(async () => payload({ text: undefined })),
    })
    void session.open(request())
    await flush()
    await session.leave()
    expect(deps.cancelJob).toHaveBeenCalledWith('job')
    expect(deps.hide).not.toHaveBeenCalled()
    expect(session.state.value.phase).toBe('cancelled')
  })

  it('leaves a finished run alone', async () => {
    const { deps, session } = setup()
    await session.open(request())
    await session.leave()
    expect(deps.cancelJob).not.toHaveBeenCalled()
    expect(session.state.value.phase).toBe('result')
  })

  it('cancels its run when disposed', async () => {
    const { deps, session } = setup(undefined, {
      claim: vi.fn(async () => payload({ text: undefined })),
    })
    void session.open(request())
    await flush()
    session.dispose()
    expect(deps.cancelJob).toHaveBeenCalledWith('job')
  })
})
