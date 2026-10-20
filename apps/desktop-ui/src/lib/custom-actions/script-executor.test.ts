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
  it('names the saved command instead of passing its shell command', () => {
    expect(
      buildScriptRequest('sc1', 'x', {
        captureOutput: true,
        isOutputLogged: false,
      })
    ).toEqual({
      commandId: 'sc1',
      text: 'x',
      captureOutput: true,
      logOutput: false,
    })
  })

  it('passes an empty text for a call without one', () => {
    expect(
      buildScriptRequest('backup', null, {
        captureOutput: false,
        isOutputLogged: false,
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
