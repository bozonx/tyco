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
  it('rejects replacing a selection as the fallback for no selection', () => {
    let command = createCommand('script', 'test')
    const model = createCommandEditorModel({
      getCommand: () => command,
      update: (value) => {
        command = value
      },
    })
    const previous = command.launcherAfterRun.fallback
    model.updateLauncherAfterRun('fallback', 'replaceSelection')
    expect(command.launcherAfterRun.fallback).toBe(previous)
    model.updateLauncherAfterRun('action', 'replaceSelection')
    expect(command.launcherAfterRun.action).toBe('replaceSelection')
  })
})
