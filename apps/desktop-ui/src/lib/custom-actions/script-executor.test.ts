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
  it('asks once, as the backend keeps a cancel that overtakes the start', async () => {
    const cancel = vi.fn(async () => false)
    cancelScriptRun(cancel, 'run-1', () => false)
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('run-1')
  })

  it('does not ask for a run that is over', () => {
    const cancel = vi.fn(async () => true)
    cancelScriptRun(cancel, 'run-2', () => true)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('swallows a failed request', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('gone')
    })
    cancelScriptRun(cancel, 'run-3', () => false)
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
