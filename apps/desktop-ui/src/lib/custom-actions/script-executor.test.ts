import { describe, expect, it } from 'vitest'

import type { ScriptExecutionResult } from '@tyco/shared'

import { buildScriptRequest, scriptFailureDetail } from './script-executor'

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
