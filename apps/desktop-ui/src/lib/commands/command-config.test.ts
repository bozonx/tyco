import { describe, expect, it } from 'vitest'

import type {
  CommandConfig,
  MainActionConfig,
  ShortcutSlots,
} from '@tyco/shared'

import { testTools } from '../tools/testing'

import {
  commandAfterRun,
  commandLabel,
  commandTakesText,
  commandTarget,
  isMenuCommand,
  suggestCommandName,
  validateCommand,
} from './command-runtime'
import {
  commandCliCall,
  findExternalCommandNameConflicts,
  normalizeCommandName,
} from './command-external'
import {
  createCommand,
  normalizeCommand,
  normalizeCommands,
  normalizeLauncherCommands,
  scriptToolConfigOf,
} from './command-config'
import {
  removeCommandReferences,
  restoreCommand,
  restoreCommandReferences,
} from './command-removal-model'

const tools = testTools()

/** A new command with a name, which a command must have */
const namedCommand = (toolId: string, id: string): CommandConfig => ({
  ...createCommand(toolId, id),
  name: 'Command',
})

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
      toolConfig: { command: 'echo', workingDirectory: '' },
      isLlmArgumentParsingEnabled: false,
      isVoiceEnabled: false,
      voiceConfirmation: 'always',
      launcherAfterRun: { action: 'none' },
      isOutputLogged: false,
      availableIn: { external: false, chat: false },
      isEnabled: true,
    })
  })

  it('ignores removed output settings', () => {
    const command = normalizeCommand({
      id: 'command',
      toolId: 'script',
      afterRun: 'copy',
    })!
    expect(command.launcherAfterRun).toEqual({ action: 'none' })
    expect(command).not.toHaveProperty('afterRun')
  })

  it('keeps the action and ignores unsupported settings', () => {
    expect(
      normalizeCommand({
        id: 'new',
        toolId: 'script',
        afterRun: 'copy',
        launcherAfterRun: { action: 'insertIntoWindow', fallback: 'copy' },
      })?.launcherAfterRun
    ).toEqual({ action: 'insertIntoWindow' })
    expect(
      normalizeCommand({
        id: 'partial',
        toolId: 'script',
        afterRun: 'copy',
        launcherAfterRun: { action: 'invalid' },
      })?.launcherAfterRun
    ).toEqual({ action: 'none' })
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
        },
      })?.toolConfig
    ).toEqual({
      url: 'https://x.test',
      method: 'POST',
      headers: { 'x-a': '1' },
      payloadTemplate: '',
      isAuthEnabled: false,
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

describe('scriptToolConfigOf', () => {
  it('keeps a whole positive timeout up to an hour', () => {
    expect(scriptToolConfigOf({ timeoutSec: 90.4 }).timeoutSec).toBe(90)
    expect(scriptToolConfigOf({ timeoutSec: 99999 }).timeoutSec).toBe(3600)
    expect(scriptToolConfigOf({ timeoutSec: 0 })).not.toHaveProperty(
      'timeoutSec'
    )
    expect(scriptToolConfigOf({ timeoutSec: '30' })).not.toHaveProperty(
      'timeoutSec'
    )
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
  it('keeps external access opt-in', () => {
    const command = createCommand('script', 'id1')
    expect(command.availableIn).toEqual({ external: false, chat: false })
  })
})

describe('menu commands', () => {
  it('admits enabled commands, with or without text', () => {
    const script = createCommand('script', 'a')
    expect(isMenuCommand(script, tools)).toBe(true)
    expect(isMenuCommand({ ...script, isEnabled: false }, tools)).toBe(false)
    expect(commandTakesText(script, tools)).toBe(false)
    expect(isMenuCommand(script, tools)).toBe(true)
    expect(commandTakesText({ ...script, toolId: 'notes.write' }, tools)).toBe(
      false
    )
  })

  it('takes the text a script mentions', () => {
    const script = (command: string) =>
      withConfig(createCommand('script', 'a'), { command })
    expect(commandTakesText(script('echo {{TEXT}}'), tools)).toBe(true)
    expect(commandTakesText(script('printf %s "$TYCO_TEXT"'), tools)).toBe(
      false
    )
    expect(commandTakesText(script('backup.sh'), tools)).toBe(false)
  })

  it('takes the text where the placeholder of a webhook stands', () => {
    const webhook = (toolConfig: Record<string, unknown>) =>
      withConfig(createCommand('webhook', 'a'), {
        url: 'https://x.test',
        ...toolConfig,
      })
    expect(
      commandTakesText(webhook({ url: 'https://x.test/{{TEXT}}' }), tools)
    ).toBe(true)
    expect(
      commandTakesText(webhook({ payloadTemplate: '{"t":"{{TEXT}}"}' }), tools)
    ).toBe(true)
    // a GET request has no body
    expect(
      commandTakesText(
        webhook({ method: 'GET', payloadTemplate: '{"t":"{{TEXT}}"}' }),
        tools
      )
    ).toBe(false)
    expect(commandTakesText(webhook({}), tools)).toBe(false)
  })

  it('suggests a name from the program of a script or the host of a webhook', () => {
    const script = (command: string) =>
      suggestCommandName(withConfig(createCommand('script', 's'), { command }))
    expect(script('ls -la')).toBe('ls')
    expect(script("'/home/me/dev files/test.sh' {{TEXT}}")).toBe('test.sh')
    expect(script('/usr/bin/backup')).toBe('backup')
    expect(script('  ')).toBe('')
    const hook = (url: string) =>
      suggestCommandName(withConfig(createCommand('webhook', 'w'), { url }))
    expect(hook('https://hooks.example.com/x?y=1')).toBe('hooks.example.com')
    expect(hook('not a url')).toBe('')
    expect(suggestCommandName(createCommand('core.aiTask', 'a'))).toBe('')
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
        {
          q: { type: 'command', commandId: 'a' },
          e: { type: 'command', commandId: 'b' },
          r: { type: 'standard', actionId: 'translation' },
          t: { type: 'command', commandId: 'a' },
        },
        'a'
      )
    ).toEqual({
      e: { type: 'command', commandId: 'b' },
      r: { type: 'standard', actionId: 'translation' },
    })
  })
})

describe('validateCommand', () => {
  it('requires a name', () => {
    const script = withConfig(createCommand('script', 'a'), { command: 'ls' })
    expect(validateCommand(script, tools)).toEqual([
      { field: 'name', messageKey: 'commands.errorNoName' },
    ])
    expect(validateCommand({ ...script, name: '  ' }, tools)).toHaveLength(1)
  })

  it('requires the command of a script and the URL of a webhook', () => {
    expect(validateCommand(namedCommand('script', 'a'), tools)).toEqual([
      { field: 'command', messageKey: 'commands.errorNoCommand' },
    ])
    expect(validateCommand(namedCommand('webhook', 'a'), tools)).toEqual([
      { field: 'url', messageKey: 'commands.errorNoUrl' },
    ])
  })

  it('allows the placeholder in a command that takes text', () => {
    expect(
      validateCommand(
        withConfig(namedCommand('script', 'a'), {
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
    const d = { ...named('d', 'свет'), isEnabled: false }
    const commands = [a, b, c, d, named('e', 'Other')]
    expect(findExternalCommandNameConflicts(commands, a, tools)).toEqual([b])
    // a command that may not be called has no twins to warn about
    expect(findExternalCommandNameConflicts(commands, c, tools)).toEqual([])
    expect(
      findExternalCommandNameConflicts(commands, named('f', ''), tools)
    ).toEqual([])
  })
})

describe('commands of the core tools', () => {
  it('start with the settings and the output handling of their tool', () => {
    const translate = createCommand('core.translate', 't', {
      defaultAfterRun: 'insertIntoWindow',
    })
    expect(translate.toolConfig).toEqual({ language: '' })
    expect(translate.launcherAfterRun).toEqual({ action: 'insertIntoWindow' })
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
      validateCommand(namedCommand('core.translate', 't'), coreTools)
    ).toEqual([{ field: 'language', messageKey: 'commands.errorNoLanguage' }])
    expect(
      validateCommand(
        withConfig(namedCommand('core.aiTask', 'a'), { prompt: 'Shorter' }),
        coreTools
      )
    ).toEqual([])
    expect(validateCommand(namedCommand('Gone.tool', 'g'), coreTools)).toEqual([
      { field: 'toolId', messageKey: 'commands.errorUnknownTool' },
    ])
  })
})

describe('normalizeLauncherCommands', () => {
  it('lists the 15 slots and drops missing command ids', () => {
    const cmd1 = createCommand('script', 'cmd1')
    const slots = normalizeLauncherCommands({ q: 'cmd1', w: 'missing' }, [cmd1])
    expect(slots).toHaveLength(15)
    expect(slots[0]).toBe('cmd1')
    expect(slots[1]).toBeNull()
    expect(slots[2]).toBeNull()
    expect(slots[14]).toBeNull()
  })

  it('leaves missing slots empty instead of reading removed launcher flags', () => {
    const configuredCommand = {
      ...createCommand('script', 'leg1'),
      availableIn: { launcher: true, external: true, chat: false },
    }
    const slots = normalizeLauncherCommands(undefined, [configuredCommand])
    expect(slots).toHaveLength(15)
    expect(slots.every((slot) => slot === null)).toBe(true)
    expect(slots[1]).toBeNull()
  })
})

describe('command removal', () => {
  const a = createCommand('script', 'a')
  const b = createCommand('script', 'b')
  const c = createCommand('script', 'c')

  it('puts a command back at its index', () => {
    expect(restoreCommand([a, c], b, 1).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(restoreCommand([a], c, 5).map((item) => item.id)).toEqual(['a', 'c'])
    expect(restoreCommand([a, b], b, 0).map((item) => item.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('refills only the menu slots that held the command and are empty', () => {
    const previous: ShortcutSlots<MainActionConfig> = {
      q: { type: 'command', commandId: 'b' },
      w: { type: 'command', commandId: 'b' },
      e: { type: 'standard', actionId: 'translation' },
    }
    const current: ShortcutSlots<MainActionConfig> = {
      w: { type: 'command', commandId: 'a' },
      e: { type: 'standard', actionId: 'translation' },
    }
    expect(restoreCommandReferences(current, previous, 'b')).toEqual({
      q: { type: 'command', commandId: 'b' },
      w: { type: 'command', commandId: 'a' },
      e: { type: 'standard', actionId: 'translation' },
    })
  })
})

describe('commandCliCall', () => {
  it('quotes an id only when the shell needs it', () => {
    expect(commandCliCall('translate-en')).toBe('tyco-ctl run translate-en')
    expect(commandCliCall("it's mine")).toBe("tyco-ctl run 'it'\\''s mine'")
    expect(commandCliCall('Work note', true)).toBe(
      "tyco-ctl run --name 'Work note'"
    )
  })
})

describe('commandAfterRun', () => {
  it('uses quick-command settings only in their matching context', () => {
    const command = {
      ...createCommand('script'),
      launcherAfterRun: { action: 'insertIntoWindow' as const },
    }
    expect(commandAfterRun(command, 'launcher')).toBe('insertIntoWindow')
    expect(commandAfterRun(command, 'menu')).toBe('showMenu')
    expect(commandAfterRun(command, 'external')).toBe('return')
  })
})
