import { describe, expect, it, vi } from 'vitest'

import { type MainActionConfig, type ShortcutSlots } from '@tyco/shared'

import { createCommand } from './command-config'
import { createCommandRemovalModel } from './command-removal-model'

describe('command removal model', () => {
  function fixture() {
    const command = {
      ...createCommand('webhook', 'test'),
      toolConfig: {
        url: 'https://example.com',
        isAuthEnabled: true,
        authSecretId: 'webhook-auth-test',
      },
    }
    let commands = [command]
    let actions: ShortcutSlots<MainActionConfig> = {
      q: { type: 'command', commandId: command.id },
    }
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
      persist: vi.fn().mockResolvedValue(undefined),
      isSaved: () => true,
      notifyError: vi.fn(),
    })
    return {
      command,
      model,
      removeSecret,
      getCommands: () => commands,
      getActions: () => actions,
      setActions: (value: ShortcutSlots<MainActionConfig>) => {
        actions = value
      },
    }
  }
  it('undo restores the command and references without deleting its secret', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    expect(f.getCommands()).toEqual([])
    expect(f.getActions()).toEqual({})
    f.model.undoRemove()
    expect(f.getCommands()).toEqual([f.command])
    expect(f.getActions()).toEqual({
      q: { type: 'command', commandId: f.command.id },
    })
    f.model.finishRemoval()
    expect(f.removeSecret).not.toHaveBeenCalled()
  })
  it('finalizes secret deletion only once after undo is no longer offered', async () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    f.model.finishRemoval()
    f.model.finishRemoval()
    await vi.waitFor(() =>
      expect(f.removeSecret).toHaveBeenCalledExactlyOnceWith(
        'webhook-auth-test'
      )
    )
  })
  it('finalizes the previous deletion when another command is removed', async () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    f.model.removeCommand(createCommand('script', 'second'))
    await vi.waitFor(() =>
      expect(f.removeSecret).toHaveBeenCalledExactlyOnceWith(
        'webhook-auth-test'
      )
    )
    f.model.undoRemove()
    f.model.finishRemoval()
    expect(f.removeSecret).toHaveBeenCalledTimes(1)
  })

  it('undo of the next deletion does not restore a finalized command', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    const second = createCommand('script', 'second')
    f.model.removeCommand(second)
    f.model.undoRemove()
    expect(f.getCommands()).toEqual([second])
    expect(f.getActions()).toEqual({})
  })

  it('handles secret cleanup failure without retaining the pending deletion', async () => {
    const f = fixture()
    f.removeSecret.mockRejectedValue(new Error('Secret removal failed'))
    f.model.removeCommand(f.command)
    f.model.finishRemoval()
    await Promise.resolve()
    expect(f.model.removed.value).toBeNull()
    f.model.undoRemove()
    expect(f.getCommands()).toEqual([])
  })
  it('undo preserves references assigned while deletion is pending', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    const replacement: MainActionConfig = {
      type: 'command',
      commandId: 'replacement',
    }
    f.setActions({ q: replacement })
    f.model.undoRemove()
    expect(f.getCommands()).toEqual([f.command])
    expect(f.getActions()).toEqual({ q: replacement })
    expect(f.removeSecret).not.toHaveBeenCalled()
  })
})
