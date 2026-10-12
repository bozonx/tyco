import { describe, expect, it, vi } from 'vitest'

import { type MainActionConfig, webhookSecretId } from '@tyco/shared'

import { createCommand } from './command-config'
import { createCommandRemovalModel } from './command-removal-model'

describe('command removal model', () => {
  function fixture() {
    const command = {
      ...createCommand('webhook', 'test'),
      toolConfig: {
        url: 'https://example.com',
        authSecret: 'tyco-secret:test',
      },
    }
    let commands = [command]
    let actions: (MainActionConfig | null)[] = [
      { type: 'command', commandId: command.id },
    ]
    const removeSecret = vi.fn().mockResolvedValue(undefined)
    const model = createCommandRemovalModel({
      getCommands: () => commands,
      getMainActions: () => actions,
      updateCommands: (value) => {
        commands = value as typeof commands
      },
      updateMainActions: (value) => {
        actions = value
      },
      removeSecret,
    })
    return {
      command,
      model,
      removeSecret,
      getCommands: () => commands,
      getActions: () => actions,
    }
  }
  it('undo restores the command and references without deleting its secret', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    expect(f.getCommands()).toEqual([])
    expect(f.getActions()).toEqual([null])
    f.model.undoRemove()
    expect(f.getCommands()).toEqual([f.command])
    expect(f.getActions()).toEqual([
      { type: 'command', commandId: f.command.id },
    ])
    f.model.finishRemoval()
    expect(f.removeSecret).not.toHaveBeenCalled()
  })
  it('finalizes secret deletion only once after undo is no longer offered', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    f.model.finishRemoval()
    f.model.finishRemoval()
    expect(f.removeSecret).toHaveBeenCalledExactlyOnceWith(
      webhookSecretId(f.command.id)
    )
  })
})
