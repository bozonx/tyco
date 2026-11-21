import { describe, expect, it } from 'vitest'

import { RUN_TIMEOUT_DEFAULT_SEC, RUN_TIMEOUT_MAX_SEC } from '@tyco/shared'

import { createCommand } from './command-config'
import { createCommandEditorModel } from './command-editor-model'

describe('command editor model', () => {
  it('removes optional values and preserves unrelated config when editing', () => {
    let command = {
      ...createCommand('script', 'test'),
      description: 'Previous',
      operationConfig: { command: 'echo test' },
    }
    const model = createCommandEditorModel({
      getCommand: () => command,
      update: (value) => {
        command = value as typeof command
      },
    })
    model.updateDescription(' ')
    expect(command.description).toBe('')
    model.updateRunTimeout(String(RUN_TIMEOUT_MAX_SEC + 1))
    expect(command.runTimeoutSec).toBe(RUN_TIMEOUT_MAX_SEC)
    model.updateRunTimeout('1.6')
    expect(command.runTimeoutSec).toBe(2)
    model.updateRunTimeout('')
    expect(command.runTimeoutSec).toBe(RUN_TIMEOUT_DEFAULT_SEC)
    model.updateRunTimeout('10abc')
    expect(command.runTimeoutSec).toBe(RUN_TIMEOUT_DEFAULT_SEC)
    expect(command.operationConfig.command).toBe('echo test')
  })
  it('sets the output action of quick commands', () => {
    let command = createCommand('script', 'test')
    const model = createCommandEditorModel({
      getCommand: () => command,
      update: (value) => {
        command = value
      },
    })
    model.updateOutputAction('insertIntoWindow')
    expect(command.outputAction).toBe('insertIntoWindow')
  })
})
