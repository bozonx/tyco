import { describe, expect, it } from 'vitest'

import {
  EXTERNAL_TIMEOUT_DEFAULT_SEC,
  EXTERNAL_TIMEOUT_MAX_SEC,
} from '@tyco/shared'

import { createCommand } from './command-config'
import { createCommandEditorModel } from './command-editor-model'

describe('command editor model', () => {
  it('removes optional values and preserves unrelated config when editing', () => {
    let command = {
      ...createCommand('script', 'test'),
      description: 'Previous',
      toolConfig: { command: 'echo test' },
    }
    const model = createCommandEditorModel({
      getCommand: () => command,
      update: (value) => {
        command = value as typeof command
      },
    })
    model.updateDescription(' ')
    expect(command.description).toBe('')
    model.updateExternalTimeout(String(EXTERNAL_TIMEOUT_MAX_SEC + 1))
    expect(command.externalTimeoutSec).toBe(EXTERNAL_TIMEOUT_MAX_SEC)
    model.updateExternalTimeout('1.6')
    expect(command.externalTimeoutSec).toBe(2)
    model.updateExternalTimeout('')
    expect(command.externalTimeoutSec).toBe(EXTERNAL_TIMEOUT_DEFAULT_SEC)
    model.updateExternalTimeout('10abc')
    expect(command.externalTimeoutSec).toBe(EXTERNAL_TIMEOUT_DEFAULT_SEC)
    expect(command.toolConfig.command).toBe('echo test')
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
