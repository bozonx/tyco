import commandNames from '../../../../../packages/shared/fixtures/command-names.json'
import { describe, expect, it } from 'vitest'

import {
  type CommandConfig,
  COMMAND_RUN_TIMEOUT_DEFAULT_SEC,
} from '@tyco/shared'

import { testOperations, testTranslateOperation } from '../operations/testing'

import {
  commandAfterRun,
  commandLabel,
  commandTakesText,
  commandTarget,
  isMenuCommand,
  menuCommandUnavailableReason,
  suggestCommandName,
  validateCommand,
} from './command-runtime'
import {
  commandCliCall,
  platformCliShell,
  externalCommandNameConflicts,
  normalizeCommandName,
} from './command-external'
import {
  runTimeoutOf,
  createCommand,
  isCommandEmpty,
  isCommandOperation,
  normalizeCommands,
  scriptOperationConfigOf,
  operationConfigText,
} from './command-config'
import { removeCommandReferences } from './command-removal-model'

const tools = testOperations()

/** A new command with a name, which a command must have */
const namedCommand = (operationId: string, id: string): CommandConfig => ({
  ...createCommand(operationId, id),
  name: 'Command',
})

const withConfig = (
  command: CommandConfig,
  operationConfig: Record<string, unknown>
): CommandConfig => ({
  ...command,
  operationConfig: { ...command.operationConfig, ...operationConfig },
})

/** One command read by the shared normalizer, or undefined when it is dropped */
const normalizeCommand = (value: unknown) => normalizeCommands([value])[0]

describe('normalizeCommands for one command', () => {
  it('fills the defaults of a sparse command', () => {
    expect(
      normalizeCommand({
        id: 'sc1',
        operationId: 'script',
        operationConfig: { command: 'echo' },
        afterRun: 'bogus',
        confirm: 'never',
        availableIn: { launcher: true, external: 'yes' },
      })
    ).toEqual({
      id: 'sc1',
      name: '',
      description: '',
      phrases: [],
      operationId: 'script',
      operationConfig: { command: 'echo' },
      isLlmArgumentParsingEnabled: false,
      isLlmPreTransformEnabled: false,
      llmPreTransformPrompt: '',
      isVoiceEnabled: false,
      outputAction: 'none',
      isOutputLogged: false,
      isAvailableExternally: false,
      isEnabled: true,
      // fields it does not know stay for the build that wrote them
      afterRun: 'bogus',
      confirm: 'never',
      availableIn: { launcher: true, external: 'yes' },
    })
  })

  it('keeps a known output action and repairs an unknown one', () => {
    expect(
      normalizeCommand({
        id: 'new',
        operationId: 'script',
        outputAction: 'insertIntoWindow',
      })?.outputAction
    ).toBe('insertIntoWindow')
    expect(
      normalizeCommand({
        id: 'partial',
        operationId: 'script',
        outputAction: 'copy',
      })?.outputAction
    ).toBe('none')
  })

  it('normalizes the settings of a webhook', () => {
    expect(
      normalizeCommand({
        id: 'wh1',
        operationId: 'webhook',
        operationConfig: {
          url: 'https://x.test',
          method: 'PUT',
          headers: { 'x-a': '1', 'x-b': 2 },
        },
      })?.operationConfig
    ).toEqual({
      url: 'https://x.test',
      method: 'POST',
      headers: { 'x-a': '1' },
    })
  })

  it('keeps the settings of a tool it does not know', () => {
    const operationConfig = { folder: '~/notes', mode: 1 }
    expect(
      normalizeCommand({
        id: 'n1',
        operationId: 'notes.write',
        operationConfig,
      })?.operationConfig
    ).toEqual(operationConfig)
  })

  it('drops a command without an id or a tool', () => {
    expect(normalizeCommand({ id: ' ', operationId: 'script' })).toBeUndefined()
    expect(normalizeCommand({ id: 'a' })).toBeUndefined()
    expect(normalizeCommand('script')).toBeUndefined()
  })

  it('repairs an id that breaks the schema instead of dropping the command', () => {
    expect(normalizeCommand({ id: 'My Cmd!', operationId: 'script' })?.id).toBe(
      'my-cmd'
    )
    expect(
      normalizeCommands([
        { id: 'notes', operationId: 'script' },
        { id: 'Notes', operationId: 'script' },
        { id: 'Скрипт', operationId: 'script' },
      ]).map((command) => command.id)
    ).toEqual(['notes', 'notes-2', 'command'])
  })
})

describe('runTimeoutOf', () => {
  it('keeps a whole positive limit up to an hour, 0 for unbounded, the default otherwise', () => {
    expect(runTimeoutOf(90.4)).toBe(90)
    expect(runTimeoutOf(99999)).toBe(3600)
    expect(runTimeoutOf(0)).toBe(0)
    expect(runTimeoutOf(-10)).toBe(0)
    expect(runTimeoutOf('30')).toBe(COMMAND_RUN_TIMEOUT_DEFAULT_SEC)
    expect(runTimeoutOf(Number.NaN)).toBe(COMMAND_RUN_TIMEOUT_DEFAULT_SEC)
  })
})

describe('scriptOperationConfigOf', () => {
  it('reads the command, the directory and the detached flag only', () => {
    expect(
      scriptOperationConfigOf({
        command: 'ls',
        workingDirectory: '~',
        timeoutSec: 5,
      })
    ).toEqual({ command: 'ls', workingDirectory: '~', isDetached: false })
    expect(
      scriptOperationConfigOf({ command: 'firefox', isDetached: true })
    ).toMatchObject({ isDetached: true })
    // only an explicit `true` detaches a command
    expect(
      scriptOperationConfigOf({ command: 'firefox', isDetached: 'yes' })
    ).toMatchObject({ isDetached: false })
  })
})

describe('normalizeCommands', () => {
  it('keeps the first of commands with the same id', () => {
    const commands = normalizeCommands([
      { id: 'a', operationId: 'script', name: 'First' },
      { id: 'a', operationId: 'script', name: 'Second' },
      null,
    ])
    expect(commands.map((command) => command.name)).toEqual(['First'])
  })

  it('reads a missing library as the default one, an empty one as it is', () => {
    expect(normalizeCommands(undefined)).toEqual([])
    expect(normalizeCommands([])).toEqual([])
  })
})

describe('createCommand', () => {
  it('keeps external access opt-in', () => {
    const command = createCommand('script', 'id1')
    expect(command.isAvailableExternally).toBe(false)
  })
})

describe('menu commands', () => {
  it('admits enabled commands, with or without text', () => {
    const script = withConfig(createCommand('script', 'a'), { command: 'ls' })
    expect(isMenuCommand(script, tools)).toBe(true)
    expect(isMenuCommand({ ...script, isEnabled: false }, tools)).toBe(false)
    expect(commandTakesText(script, tools)).toBe(false)
    expect(isMenuCommand(script, tools)).toBe(true)
    expect(
      commandTakesText({ ...script, operationId: 'notes.write' }, tools)
    ).toBe(false)
  })

  it('requires runnable settings and values for parameters the menu cannot supply', () => {
    const operations = testOperations({}, [testTranslateOperation()])
    const translation = createCommand('core.translate', 'translate')
    expect(menuCommandUnavailableReason(translation, operations)).toBe(
      'commands.errorNoLanguage'
    )
    expect(
      isMenuCommand(withConfig(translation, { language: 'en-US' }), operations)
    ).toBe(true)
    expect(
      menuCommandUnavailableReason(createCommand('script', 'empty'), operations)
    ).toBe('commands.errorNoCommand')
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
    const webhook = (operationConfig: Record<string, unknown>) =>
      withConfig(createCommand('webhook', 'a'), {
        url: 'https://x.test',
        ...operationConfig,
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
    const long = withConfig(createCommand('script', 'b'), {
      command: `curl -H 'Authorization: token' ${'x'.repeat(80)}\necho done`,
    })
    expect(commandLabel(long)).toHaveLength(61)
    expect(commandLabel(long)).not.toContain('echo done')
  })

  it('removes every reference to a command from the menu', () => {
    expect(
      removeCommandReferences(
        {
          q: { type: 'command', commandId: 'a' },
          e: { type: 'command', commandId: 'b' },
          r: { type: 'standard', actionId: 'translationMenu' },
          t: { type: 'command', commandId: 'a' },
        },
        'a'
      )
    ).toEqual({
      e: { type: 'command', commandId: 'b' },
      r: { type: 'standard', actionId: 'translationMenu' },
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

  it('requires an http(s) URL, placeholder allowed', () => {
    const hook = (url: string) =>
      validateCommand(withConfig(namedCommand('webhook', 'a'), { url }), tools)
    expect(hook('ftp://x.test')).toEqual([
      { field: 'url', messageKey: 'commands.errorInvalidUrl' },
    ])
    expect(hook('not a url')).toHaveLength(1)
    expect(hook('https://x.test/?q={{TEXT}}')).toEqual([])
    expect(hook('{{TEXT}}')).toHaveLength(1)
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
    isAvailableExternally: external,
  })

  it('compares names regardless of case, ё and spaces', () => {
    expect(normalizeCommandName('  Ёлка   ЗАПИСЬ ')).toBe('елка запись')
    for (const [name, expected] of commandNames.cases)
      expect(normalizeCommandName(name)).toBe(expected)
  })

  it('finds the other callable commands of the same name', () => {
    const a = named('a', 'Свёт')
    const b = named('b', ' свет ')
    const c = named('c', 'Свет', false)
    const d = { ...named('d', 'свет'), isEnabled: false }
    const commands = [a, b, c, d, named('e', 'Other'), named('f', '')]
    const conflicts = externalCommandNameConflicts(commands, tools)
    expect(conflicts.get('a')).toEqual([b])
    expect(conflicts.get('b')).toEqual([a])
    // a command that may not be called has no twins to warn about
    expect(conflicts.has('c')).toBe(false)
    expect(conflicts.has('e')).toBe(false)
    expect(conflicts.has('f')).toBe(false)
  })
})

describe('commands of the core tools', () => {
  it('start with the settings and the output handling of their tool', () => {
    const aiTask = createCommand('core.aiTask', 'a', {
      defaultOutputAction: 'insertIntoWindow',
    })
    expect(aiTask.operationConfig).toEqual({ prompt: '', tools: [] })
    expect(aiTask.outputAction).toBe('insertIntoWindow')
    expect(aiTask.platforms).toBeUndefined()
    expect(createCommand('Notes.write', 'n').operationConfig).toEqual({})
    expect(
      createCommand('script', 's', { canSelectPlatforms: true }, 'windows')
        .platforms
    ).toEqual(['windows'])
    expect(
      createCommand('script', 's', { canSelectPlatforms: true }, 'macos')
        .platforms
    ).toBeUndefined()
  })

  it('need an instruction for AI command', () => {
    const coreOperations = testOperations({}, [
      {
        id: 'core.aiTask',
        description: '',
        inputSchema: { type: 'object', properties: {} },
        run: async () => ({ ok: true }),
      },
    ])
    expect(
      validateCommand(namedCommand('core.aiTask', 'a'), coreOperations)
    ).toEqual([{ field: 'prompt', messageKey: 'commands.errorNoPrompt' }])
    expect(
      validateCommand(
        withConfig(namedCommand('core.aiTask', 'a'), { prompt: 'Shorter' }),
        coreOperations
      )
    ).toEqual([])
    expect(
      validateCommand(namedCommand('Gone.tool', 'g'), coreOperations)
    ).toEqual([
      { field: 'operationId', messageKey: 'commands.errorUnknownType' },
    ])
  })

  it('identifies selectable command tools', () => {
    expect(isCommandOperation({ id: 'script', owner: { kind: 'core' } })).toBe(
      true
    )
    expect(isCommandOperation({ id: 'webhook', owner: { kind: 'core' } })).toBe(
      true
    )
    expect(
      isCommandOperation({ id: 'core.aiTask', owner: { kind: 'core' } })
    ).toBe(true)
    expect(
      isCommandOperation({ id: 'core.translate', owner: { kind: 'core' } })
    ).toBe(false)
    expect(
      isCommandOperation({ id: 'core.insert', owner: { kind: 'core' } })
    ).toBe(false)
    expect(
      isCommandOperation({ id: 'core.copy', owner: { kind: 'core' } })
    ).toBe(false)
    expect(
      isCommandOperation({ id: 'core.correct', owner: { kind: 'core' } })
    ).toBe(false)
    expect(
      isCommandOperation({ id: 'core.askInChat', owner: { kind: 'core' } })
    ).toBe(false)
    expect(
      isCommandOperation({
        id: 'Plugin.action',
        owner: { kind: 'plugin', pluginId: 'plugin' },
        configFields: [],
      })
    ).toBe(false)
    expect(
      isCommandOperation({
        id: 'Plugin.action',
        owner: { kind: 'plugin', pluginId: 'plugin' },
        configFields: [{ name: 'folder', type: 'text' }],
      })
    ).toBe(true)
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

  it('quotes for PowerShell on Windows', () => {
    expect(commandCliCall("it's mine", true, 'powershell')).toBe(
      "tyco-ctl run --name 'it''s mine'"
    )
    expect(commandCliCall('$HOME', false, 'powershell')).toBe(
      "tyco-ctl run '$HOME'"
    )
    expect(platformCliShell('Mozilla/5.0 (Windows NT 10.0; Win64)')).toBe(
      'powershell'
    )
    expect(platformCliShell('Mozilla/5.0 (X11; Linux x86_64)')).toBe('posix')
  })
})

describe('commandAfterRun', () => {
  it('uses command output settings in the action menu, launcher and externally', () => {
    const command = {
      ...createCommand('script'),
      outputAction: 'insertIntoWindow' as const,
    }
    expect(commandAfterRun(command, 'launcher')).toBe('insertIntoWindow')
    expect(commandAfterRun(command, 'menu')).toBe('insertIntoWindow')
    expect(commandAfterRun(command, 'external')).toBe('return')
  })
})

describe('operationConfigText', () => {
  it('reads a text setting and takes anything else as empty', () => {
    const command = {
      ...createCommand('core.translateTo', 'id1'),
      operationConfig: { language: 'de-DE', count: 3 },
    }
    expect(operationConfigText(command, 'language')).toBe('de-DE')
    expect(operationConfigText(command, 'count')).toBe('')
    expect(operationConfigText(command, 'missing')).toBe('')
  })
})

describe('isCommandEmpty', () => {
  it('returns true when a command has no name, description, phrases, or pre-transform prompt', () => {
    const command = createCommand('script')
    expect(isCommandEmpty(command)).toBe(true)
  })

  it('returns false when any meaningful field is set', () => {
    expect(isCommandEmpty({ ...createCommand('script'), name: 'Test' })).toBe(
      false
    )
    expect(
      isCommandEmpty({ ...createCommand('script'), description: 'Desc' })
    ).toBe(false)
    expect(
      isCommandEmpty({ ...createCommand('script'), phrases: ['phrase'] })
    ).toBe(false)
    expect(
      isCommandEmpty({
        ...createCommand('script'),
        llmPreTransformPrompt: 'Prompt',
      })
    ).toBe(false)
  })
})
