import { describe, expect, it, vi } from 'vitest'

import type { ScriptExecutionResult } from '@tyco/shared'

import {
  buildScriptRequest,
  cancelScriptRun,
  scriptFailureDetail,
} from './script-executor'

const result = (
  extra: Partial<ScriptExecutionResult> = {}
): ScriptExecutionResult => ({
  success: true,
  exitCode: 0,
  stdout: '',
  stderr: '',
  running: false,
  ...extra,
})

describe('buildScriptRequest', () => {
  it('trims the working directory and drops an empty one', () => {
    const options = { captureOutput: true, logOutput: false }
    expect(
      buildScriptRequest(
        'Echo',
        { command: 'echo', workingDir: ' /tmp ' },
        'x',
        options
      )
    ).toEqual({
      name: 'Echo',
      command: 'echo',
      workingDir: '/tmp',
      text: 'x',
      captureOutput: true,
      logOutput: false,
    })
    expect(
      buildScriptRequest(
        'Echo',
        { command: 'echo', workingDir: ' ' },
        'x',
        options
      ).workingDir
    ).toBeUndefined()
  })

  it('passes the timeout of the command only when it has one', () => {
    const options = { captureOutput: true, logOutput: false }
    expect(
      buildScriptRequest(
        'Echo',
        { command: 'echo', timeoutSec: 5 },
        '',
        options
      ).timeoutSec
    ).toBe(5)
    expect(
      buildScriptRequest('Echo', { command: 'echo' }, '', options)
    ).not.toHaveProperty('timeoutSec')
  })

  it('passes an empty text for a call without one', () => {
    expect(
      buildScriptRequest('Backup', { command: 'backup.sh' }, null, {
        captureOutput: false,
        logOutput: false,
      }).text
    ).toBe('')
  })
})

describe('scriptFailureDetail', () => {
  it('takes the first line of stderr', () => {
    expect(
      scriptFailureDetail(
        result({ success: false, stderr: '\nsh: foo: not found\nmore' })
      )
    ).toBe('sh: foo: not found')
  })

  it('falls back to the exit code', () => {
    expect(scriptFailureDetail(result({ success: false, exitCode: 2 }))).toBe(
      'exit code 2'
    )
  })
})

describe('cancelScriptRun', () => {
  it('asks again while the run is not registered yet, and stops once it is over', async () => {
    vi.useFakeTimers()
    try {
      const cancel = vi
        .fn<(runId: string) => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
      cancelScriptRun(cancel, 'run-1', () => false)
      await vi.advanceTimersByTimeAsync(500)
      expect(cancel).toHaveBeenCalledTimes(2)

      const late = vi.fn(async () => false)
      let over = false
      cancelScriptRun(late, 'run-2', () => over)
      await vi.advanceTimersByTimeAsync(0)
      over = true
      await vi.advanceTimersByTimeAsync(1000)
      expect(late).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
