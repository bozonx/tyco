import { describe, expect, it, vi } from 'vitest'

import { type ActionPageConfig } from '@tyco/shared'

import { secretRef } from '../net/secrets'
import { createCommand } from './command-config'
import { commandSecretIds, isSecretReferenced } from './command-secrets'
import {
  createCommandRemovalModel,
  removeCommandFromAiCommands,
  removeCommandFromCustomActionSlots,
} from './command-removal-model'

describe('command removal model', () => {
  function fixture() {
    const command = {
      ...createCommand('webhook', 'test'),
      operationConfig: {
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

  it('removes the command and references in action pages', () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    expect(f.getCommands()).toEqual([])
    expect(f.getPages()[0]?.slots).toEqual({})
  })

  it('cleans up webhook secrets after removal', async () => {
    const f = fixture()
    f.model.removeCommand(f.command)
    await vi.waitFor(() =>
      expect(f.removeSecret).toHaveBeenCalledExactlyOnceWith(
        'webhook.auth.test'
      )
    )
  })

  it('keeps a secret another command still refers to', async () => {
    const f = fixture()
    const twin = {
      ...createCommand('webhook', 'twin'),
      operationConfig: {
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
    await vi.waitFor(() => expect(persist).toHaveBeenCalled())
    await Promise.resolve()
    expect(removeSecret).not.toHaveBeenCalled()
  })

  it('finds the secrets of a webhook in its headers and its Authorization', () => {
    const command = {
      ...createCommand('webhook', 'hook'),
      operationConfig: {
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

  it('handles secret cleanup failure without breaking command deletion', async () => {
    const f = fixture()
    const notifyError = vi.fn()
    const error = new Error('Secret removal failed')
    f.removeSecret.mockRejectedValue(error)
    let commands = [f.command]
    const model = createCommandRemovalModel({
      getCommands: () => commands,
      getActionPages: () => [],
      updateCommands: (value) => {
        commands = value as typeof commands
      },
      updateActionPages: vi.fn(),
      removeSecret: f.removeSecret,
      persist: vi.fn().mockResolvedValue(undefined),
      isSaved: () => true,
      notifyError,
    })
    model.removeCommand(f.command)
    await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith(error))
    expect(commands).toEqual([])
  })

  it('leaves the custom hotkeys of the command without action', () => {
    const f = fixture()
    expect(
      removeCommandFromCustomActionSlots(
        [
          {
            action: { type: 'command', commandId: f.command.id },
            takesSelection: true,
          },
          {
            action: { type: 'command', commandId: 'other' },
            takesSelection: false,
          },
          { action: null, takesSelection: false },
        ],
        f.command.id
      )
    ).toEqual([
      { action: null, takesSelection: true },
      {
        action: { type: 'command', commandId: 'other' },
        takesSelection: false,
      },
      { action: null, takesSelection: false },
    ])
  })

  it('takes the command away from the AI commands allowed to run it', () => {
    const ai = {
      ...createCommand('core.aiTask', 'ai'),
      operationConfig: {
        prompt: 'p',
        tools: [
          { sourceKind: 'commands', sourceId: 'commands', toolName: 'gone' },
          { sourceKind: 'commands', sourceId: 'commands', toolName: 'kept' },
          { sourceKind: 'core', sourceId: 'web' },
        ],
      },
    }
    const script = createCommand('script', 'gone')
    const [nextAi, nextScript] = removeCommandFromAiCommands(
      [ai, script],
      'gone'
    )
    expect(nextAi.operationConfig.tools).toEqual([
      { sourceKind: 'commands', sourceId: 'commands', toolName: 'kept' },
      { sourceKind: 'core', sourceId: 'web' },
    ])
    expect(nextScript).toBe(script)
  })
})
