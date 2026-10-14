import { describe, expect, it } from 'vitest'

import { SCRIPT_MAX_TIMEOUT_SEC } from '@tyco/shared'

import { createCommand } from './command-config'
import { createCommandEditorModel } from './command-editor-model'

describe('command editor model', () => {
  it('removes optional values and preserves unrelated config when editing', () => {
    let command = {
      ...createCommand('script', 'test'),
      description: 'Previous',
      toolConfig: { command: 'echo test', timeoutSec: 2 },
    }
    const model = createCommandEditorModel({
      getCommand: () => command,
      update: (value) => {
        command = value as typeof command
      },
    })
    model.updateDescription(' ')
    expect(command).not.toHaveProperty('description')
    model.updateTimeout(String(SCRIPT_MAX_TIMEOUT_SEC + 1))
    expect(command.toolConfig.timeoutSec).toBe(SCRIPT_MAX_TIMEOUT_SEC)
    model.updateTimeout('')
    expect(command.toolConfig).not.toHaveProperty('timeoutSec')
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
    model.updateLauncherAfterRun('insertIntoWindow')
    expect(command.launcherAfterRun).toEqual({ action: 'insertIntoWindow' })
  })
})
