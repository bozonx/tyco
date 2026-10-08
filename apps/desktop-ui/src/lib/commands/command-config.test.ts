import { describe, expect, it } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import { testTools } from '../tools/testing'

import {
  commandLabel,
  commandTakesText,
  commandTarget,
  createCommand,
  externalNameTwins,
  isMenuCommand,
  normalizeCommand,
  normalizeCommandName,
  normalizeCommands,
  normalizeLauncherCommands,
  removeCommandReferences,
  validateCommand,
} from './command-config'

const tools = testTools()

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
      availableIn: { external: false, chat: false },
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
    expect(command.availableIn).toEqual({ external: true, chat: false })
    expect(createCommand('webhook').confirm).toBe('auto')
  })
})

describe('menu commands', () => {
  it('admits only enabled commands that take text', () => {
    const script = createCommand('script', 'a')
    expect(isMenuCommand(script, tools)).toBe(true)
    expect(isMenuCommand({ ...script, enabled: false }, tools)).toBe(false)
    expect(isMenuCommand(withConfig(script, { takesText: false }), tools)).toBe(
      false
    )
    expect(commandTakesText({ ...script, toolId: 'notes.write' }, tools)).toBe(
      false
    )
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
    expect(validateCommand(createCommand('script', 'a'), tools)).toEqual([
      { field: 'command', messageKey: 'commands.errorNoCommand' },
    ])
    expect(validateCommand(createCommand('webhook', 'a'), tools)).toEqual([
      { field: 'url', messageKey: 'commands.errorNoUrl' },
    ])
  })

  it('rejects the text placeholder in a command without text', () => {
    expect(
      validateCommand(
        withConfig(createCommand('script', 'a'), {
          command: 'notify-send {{TEXT}}',
          takesText: false,
        }),
        tools
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
        }),
        tools
      ).map((issue) => issue.field)
    ).toEqual(['url', 'payloadTemplate'])
  })

  it('allows the placeholder in a command that takes text', () => {
    expect(
      validateCommand(
        withConfig(createCommand('script', 'a'), {
          command: 'notify-send {{TEXT}}',
        }),
        tools
      )
    ).toEqual([])
  })
})

describe('commandTarget', () => {
  it('shows the shell command of a script and the request of a webhook', () => {
    expect(
      commandTarget(withConfig(createCommand('script', 's'), { command: 'ls' }))
    ).toBe('ls')
    expect(
      commandTarget(
        withConfig(createCommand('webhook', 'w'), {
          url: 'https://x.test',
          method: 'GET',
        })
      )
    ).toBe('GET https://x.test')
  })
})

describe('external names', () => {
  const named = (id: string, name: string, external = true): CommandConfig => ({
    ...createCommand('webhook', id),
    name,
    availableIn: { external, chat: false },
  })

  it('compares names regardless of case, ё and spaces', () => {
    expect(normalizeCommandName('  Ёлка   ЗАПИСЬ ')).toBe('елка запись')
  })

  it('finds the other callable commands of the same name', () => {
    const a = named('a', 'Свёт')
    const b = named('b', ' свет ')
    const c = named('c', 'Свет', false)
    const d = { ...named('d', 'свет'), enabled: false }
    const commands = [a, b, c, d, named('e', 'Other')]
    expect(externalNameTwins(commands, a, tools)).toEqual([b])
    // a command that may not be called has no twins to warn about
    expect(externalNameTwins(commands, c, tools)).toEqual([])
    expect(externalNameTwins(commands, named('f', ''), tools)).toEqual([])
  })
})

describe('commands of the core tools', () => {
  it('start with the settings and the output handling of their tool', () => {
    const translate = createCommand('core.translate', 't', {
      defaultAfterRun: 'replaceSelection',
    })
    expect(translate.toolConfig).toEqual({ language: '' })
    expect(translate.afterRun).toBe('replaceSelection')
    expect(createCommand('core.aiTask', 'a').toolConfig).toEqual({ prompt: '' })
    expect(createCommand('Notes.write', 'n').toolConfig).toEqual({})
  })

  it('need a language or an instruction', () => {
    const coreTools = testTools({}, [
      {
        id: 'core.translate',
        description: '',
        inputSchema: { type: 'object', properties: {} },
        run: async () => ({ ok: true }),
      },
    ])
    expect(
      validateCommand(createCommand('core.translate', 't'), coreTools)
    ).toEqual([{ field: 'language', messageKey: 'commands.errorNoLanguage' }])
    expect(
      validateCommand(
        withConfig(createCommand('core.aiTask', 'a'), { prompt: 'Shorter' }),
        coreTools
      )
    ).toEqual([])
    expect(validateCommand(createCommand('Gone.tool', 'g'), coreTools)).toEqual(
      [{ field: 'toolId', messageKey: 'commands.errorUnknownTool' }]
    )
  })
})

describe('normalizeLauncherCommands', () => {
  it('pads to 15 slots and filters out missing command ids', () => {
    const cmd1 = createCommand('script', 'cmd1')
    const slots = normalizeLauncherCommands(['cmd1', 'missing', null], [cmd1])
    expect(slots).toHaveLength(15)
    expect(slots[0]).toBe('cmd1')
    expect(slots[1]).toBeNull()
    expect(slots[2]).toBeNull()
    expect(slots[14]).toBeNull()
  })

  it('migrates legacy commands with availableIn.launcher when value is undefined', () => {
    const legacyCmd = {
      ...createCommand('script', 'leg1'),
      availableIn: { launcher: true, external: true, chat: false },
    }
    const slots = normalizeLauncherCommands(undefined, [legacyCmd as any])
    expect(slots).toHaveLength(15)
    expect(slots[0]).toBe('leg1')
    expect(slots[1]).toBeNull()
  })
})
