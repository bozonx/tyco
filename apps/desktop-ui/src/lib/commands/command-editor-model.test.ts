import { describe, expect, it } from 'vitest'

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
