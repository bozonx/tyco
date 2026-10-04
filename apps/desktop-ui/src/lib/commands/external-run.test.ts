import { describe, expect, it, vi } from 'vitest'

import {
  type CommandConfig,
  type CommandRunEvent,
  DEFAULT_USER_CONFIG,
} from '@tyco/shared'

import { createCommand } from './command-config'
import type { CommandRunOutcome } from './command-runner'
import {
  type ExternalRunDependencies,
  type RunReport,
  createExternalRun,
} from './external-run'

const lamp: CommandConfig = {
  ...createCommand('webhook', 'lamp'),
  name: 'Lamp',
  toolConfig: { url: 'https://x.test', takesText: false },
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
  ) => Promise<CommandRunOutcome>
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
      return { success: true }
    })
    const outcome = await external.handleRun(event())

    expect(outcome).toEqual({ success: true })
    expect(deps.applyUserConfig).toHaveBeenCalled()
    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lamp' }),
      '',
      expect.any(Function)
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
    const { deps, external } = setup(async () => ({ success: true }))
    await external.handleRun(event({ text: 'buy milk' }))
    expect(deps.run).toHaveBeenCalledWith(
      expect.anything(),
      'buy milk',
      expect.any(Function)
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
    const { deps, external } = setup(async () => ({ success: true }))
    const outcome = await external.handleRun(event({ commandId: 'gone' }))
    expect(outcome.success).toBe(false)
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.notify).toHaveBeenCalledWith(
      'externalCommand.failed {"name":"gone"}',
      'externalCommand.missing'
    )
  })
})
