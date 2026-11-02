import { describe, expect, it, vi } from 'vitest'

import { type ActionPageConfig, type MainActionConfig } from '@tyco/shared'

import { secretRef } from '../net/secrets'
import { createCommand } from './command-config'
import { commandSecretIds, isSecretReferenced } from './command-secrets'
import { createCommandRemovalModel } from './command-removal-model'

describe('command removal model', () => {
  function fixture() {
    const command = {
      ...createCommand('webhook', 'test'),
      toolConfig: {
        url: 'https://example.com',
        isAuthEnabled: true,
        authSecretId: 'webhook.auth.test',
      },
    }
    let commands = [command]
    let pages: ActionPageConfig[] = [
      {
        inputMode: 'selection',
        slots: { q: { type: 'command', commandId: command.id } },
      },
    ]
    const removeSecret = vi.fn().mockResolvedValue(undefined)
    const model = createCommandRemovalModel({
      getCommands: () => commands,
      getActionPages: () => pages,
      updateCommands: (value) => {
        commands = value as typeof commands
      },
      updateActionPages: (value) => {
        pages = value
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
      getPages: () => pages,
      setPages: (value: ActionPageConfig[]) => {
        pages = value
      },
    }
  }

  it('undo restores the command and references without deleting its secret', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    expect(f.getCommands()).toEqual([])
    expect(f.getPages()[0]?.slots).toEqual({})
    f.model.undoRemove()
    expect(f.getCommands()).toEqual([f.command])
    expect(f.getPages()[0]?.slots).toEqual({
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
        'webhook.auth.test'
      )
    )
  })

  it('finalizes the previous deletion when another command is removed', async () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    f.model.removeCommand(createCommand('script', 'second'))
    await vi.waitFor(() =>
      expect(f.removeSecret).toHaveBeenCalledExactlyOnceWith(
        'webhook.auth.test'
      )
    )
    f.model.undoRemove()
    f.model.finishRemoval()
    expect(f.removeSecret).toHaveBeenCalledTimes(1)
  })

  it('keeps a secret another command still refers to', async () => {
    const f = fixture()
    const twin = {
      ...createCommand('webhook', 'twin'),
      toolConfig: {
        url: 'https://example.com',
        headers: { authorization: secretRef('webhook.auth.test') },
      },
    }
    let commands = [f.command, twin]
    const removeSecret = vi.fn().mockResolvedValue(undefined)
    const persist = vi.fn().mockResolvedValue(undefined)
    const model = createCommandRemovalModel({
      getCommands: () => commands,
      getActionPages: () => [],
      updateCommands: (value) => {
        commands = value as typeof commands
      },
      updateActionPages: vi.fn(),
      removeSecret,
      persist,
      isSaved: () => true,
      notifyError: vi.fn(),
    })
    model.removeCommand(f.command)
    model.finishRemoval()
    await vi.waitFor(() => expect(persist).toHaveBeenCalled())
    await Promise.resolve()
    expect(removeSecret).not.toHaveBeenCalled()
  })

  it('finds the secrets of a webhook in its headers and its Authorization', () => {
    const command = {
      ...createCommand('webhook', 'hook'),
      toolConfig: {
        url: 'https://example.com',
        authSecretId: 'webhook.auth.a',
        headers: { 'x-key': secretRef('webhook.header.b'), plain: 'value' },
      },
    }
    expect(commandSecretIds(command).sort()).toEqual([
      'webhook.auth.a',
      'webhook.header.b',
    ])
    expect(commandSecretIds(createCommand('script', 'script'))).toEqual([])
    expect(isSecretReferenced([command], 'webhook.header.b')).toBe(true)
    // an id that only contains another one is not a reference to it
    expect(isSecretReferenced([command], 'webhook.auth')).toBe(false)
  })

  it('undo of the next deletion does not restore a finalized command', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    const second = createCommand('script', 'second')
    f.model.removeCommand(second)
    f.model.undoRemove()
    expect(f.getCommands()).toEqual([second])
    expect(f.getPages()[0]?.slots).toEqual({})
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
    f.setPages([{ inputMode: 'selection', slots: { q: replacement } }])
    f.model.undoRemove()
    expect(f.getCommands()).toEqual([f.command])
    expect(f.getPages()[0]?.slots).toEqual({ q: replacement })
    expect(f.removeSecret).not.toHaveBeenCalled()
  })

  it('removes and restores command references in action pages', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    expect(f.getPages()[0]?.slots).toEqual({})
    f.model.undoRemove()
    expect(f.getPages()[0]?.slots).toEqual({
      q: { type: 'command', commandId: f.command.id },
    })
  })
})
