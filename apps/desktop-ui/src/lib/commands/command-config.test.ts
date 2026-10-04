import { describe, expect, it } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import {
  commandLabel,
  commandTakesText,
  createCommand,
  isMenuCommand,
  normalizeCommand,
  normalizeCommands,
  removeCommandReferences,
  validateCommand,
} from './command-config'

const withConfig = (
  command: CommandConfig,
  toolConfig: Record<string, unknown>
): CommandConfig => ({
  ...command,
  toolConfig: { ...command.toolConfig, ...toolConfig },
})

describe('normalizeCommand', () => {
  it('fills the defaults of a sparse command', () => {
    expect(
      normalizeCommand({
        id: 'sc1',
        toolId: 'script',
        toolConfig: { command: 'echo' },
        afterRun: 'bogus',
        confirm: 'never',
        availableIn: { launcher: true, external: 'yes' },
      })
    ).toEqual({
      id: 'sc1',
      name: '',
      phrases: [],
      toolId: 'script',
      toolConfig: { command: 'echo', workingDir: '', takesText: true },
      llmArgumentParsing: false,
      afterRun: 'none',
      logOutput: false,
      confirm: 'auto',
      availableIn: { launcher: true, external: false, chat: false },
      enabled: true,
    })
  })

  it('normalizes the settings of a webhook', () => {
    expect(
      normalizeCommand({
        id: 'wh1',
        toolId: 'webhook',
        toolConfig: {
          url: 'https://x.test',
          method: 'PUT',
          headers: { 'x-a': '1', 'x-b': 2 },
          takesText: false,
        },
      })?.toolConfig
    ).toEqual({
      url: 'https://x.test',
      method: 'POST',
      headers: { 'x-a': '1' },
      payloadTemplate: '',
      authSecret: false,
      takesText: false,
    })
  })

  it('keeps the settings of a tool it does not know', () => {
    const toolConfig = { folder: '~/notes', mode: 1 }
    expect(
      normalizeCommand({ id: 'n1', toolId: 'notes.write', toolConfig })
        ?.toolConfig
    ).toEqual(toolConfig)
  })

  it('drops a command without an id or a tool', () => {
    expect(normalizeCommand({ id: ' ', toolId: 'script' })).toBeNull()
    expect(normalizeCommand({ id: 'a' })).toBeNull()
    expect(normalizeCommand('script')).toBeNull()
  })
})

describe('normalizeCommands', () => {
  it('keeps the first of commands with the same id', () => {
    const commands = normalizeCommands([
      { id: 'a', toolId: 'script', name: 'First' },
      { id: 'a', toolId: 'script', name: 'Second' },
      null,
    ])
    expect(commands.map((command) => command.name)).toEqual(['First'])
  })

  it('reads a missing library as empty', () => {
    expect(normalizeCommands(undefined)).toEqual([])
  })
})

describe('createCommand', () => {
  it('asks to confirm a new script and offers it everywhere but the chat', () => {
    const command = createCommand('script', 'id1')
    expect(command.confirm).toBe('always')
    expect(command.availableIn).toEqual({
      launcher: true,
      external: true,
      chat: false,
    })
    expect(createCommand('webhook').confirm).toBe('auto')
  })
})

describe('menu commands', () => {
  it('admits only enabled commands that take text', () => {
    const script = createCommand('script', 'a')
    expect(isMenuCommand(script)).toBe(true)
    expect(isMenuCommand({ ...script, enabled: false })).toBe(false)
    expect(isMenuCommand(withConfig(script, { takesText: false }))).toBe(false)
    expect(commandTakesText({ ...script, toolId: 'notes.write' })).toBe(false)
  })

  it('names a command after its shell command when it has no name', () => {
    const script = withConfig(createCommand('script', 'a'), {
      command: 'backup.sh',
    })
    expect(commandLabel(script)).toBe('backup.sh')
    expect(commandLabel({ ...script, name: 'Backup' })).toBe('Backup')
  })

  it('removes every reference to a command from the menu', () => {
    expect(
      removeCommandReferences(
        [
          { type: 'command', commandId: 'a' },
          null,
          { type: 'command', commandId: 'b' },
          { type: 'standard', actionId: 'translation' },
        ],
        'a'
      )
    ).toEqual([
      null,
      null,
      { type: 'command', commandId: 'b' },
      { type: 'standard', actionId: 'translation' },
    ])
  })
})

describe('validateCommand', () => {
  it('requires the command of a script and the URL of a webhook', () => {
    expect(validateCommand(createCommand('script', 'a'))).toEqual([
      { field: 'command', messageKey: 'commands.errorNoCommand' },
    ])
    expect(validateCommand(createCommand('webhook', 'a'))).toEqual([
      { field: 'url', messageKey: 'commands.errorNoUrl' },
    ])
  })

  it('rejects the text placeholder in a command without text', () => {
    expect(
      validateCommand(
        withConfig(createCommand('script', 'a'), {
          command: 'notify-send {{TEXT}}',
          takesText: false,
        })
      )
    ).toEqual([
      { field: 'command', messageKey: 'commands.errorTextPlaceholder' },
    ])
    expect(
      validateCommand(
        withConfig(createCommand('webhook', 'a'), {
          url: 'https://x.test/{{TEXT}}',
          payloadTemplate: '{"t":"{{TEXT}}"}',
          takesText: false,
        })
      ).map((issue) => issue.field)
    ).toEqual(['url', 'payloadTemplate'])
  })

  it('allows the placeholder in a command that takes text', () => {
    expect(
      validateCommand(
        withConfig(createCommand('script', 'a'), {
          command: 'notify-send {{TEXT}}',
        })
      )
    ).toEqual([])
  })
})
