import { describe, expect, it } from 'vitest'

import { createCommand } from '../commands/command-config'
import type { RegisteredTool, ToolLookup } from '../tools/tool-types'
import {
  buildMainActionOptions,
  commandGroup,
  duplicatesDirectChoice,
  type MainActionChoice,
  type MainActionGroup,
  mainActionOptionId,
  pluginActionGroup,
  standardActionGroup,
} from './main-action-options'

const groupLabel = (group: MainActionGroup) =>
  group.kind === 'plugin' ? `plugin ${group.plugin}` : group.kind

describe('main action groups', () => {
  it('groups standard actions by category', () => {
    expect(standardActionGroup('translationMenu')).toEqual({ kind: 'basic' })
    expect(standardActionGroup('transformationMenu')).toEqual({ kind: 'basic' })
    expect(standardActionGroup('stylingMenu')).toEqual({ kind: 'basic' })
    expect(standardActionGroup('insertIntoWindow')).toEqual({ kind: 'basic' })
    expect(standardActionGroup('voiceCommands')).toEqual({ kind: 'basic' })
    expect(standardActionGroup('askInChat')).toEqual({ kind: 'askAi' })
    expect(standardActionGroup('quickAiRequest')).toEqual({ kind: 'askAi' })
  })

  it('groups a plugin action by its plugin', () => {
    expect(pluginActionGroup('Search:find')).toEqual({
      kind: 'plugin',
      plugin: 'Search',
    })
  })

  it('groups a command by what it does', () => {
    const notes = { owner: { kind: 'plugin', pluginId: 'Notes' } }
    const tools: ToolLookup = {
      get: (toolId) =>
        toolId === 'Notes.write'
          ? (notes as RegisteredTool)
          : ({ owner: { kind: 'core' } } as RegisteredTool),
    }

    expect(commandGroup(createCommand('core.translate'), tools)).toEqual({
      kind: 'translation',
    })
    expect(commandGroup(createCommand('core.aiTask'), tools)).toEqual({
      kind: 'aiCommands',
    })
    expect(commandGroup(createCommand('core.transformation'), tools)).toEqual({
      kind: 'transformation',
    })
    expect(commandGroup(createCommand('core.styling'), tools)).toEqual({
      kind: 'styling',
    })
    expect(commandGroup(createCommand('script'), tools)).toEqual({
      kind: 'commands',
    })
    expect(commandGroup(createCommand('webhook'), tools)).toEqual({
      kind: 'commands',
    })
    expect(commandGroup(createCommand('Notes.write'), tools)).toEqual({
      kind: 'plugin',
      plugin: 'Notes',
    })
    expect(
      commandGroup(createCommand('Gone.tool'), { get: () => undefined })
    ).toEqual({ kind: 'commands' })
  })
})

describe('buildMainActionOptions', () => {
  const choice = (id: string, group: MainActionGroup): MainActionChoice => ({
    config: { type: 'command', commandId: id },
    name: id,
    group,
  })

  it('orders the groups and keeps the order of the choices in a group', () => {
    const options = buildMainActionOptions({
      choices: [
        choice('zeta', { kind: 'plugin', plugin: 'Zeta' }),
        choice('script', { kind: 'commands' }),
        choice('toEnglish', { kind: 'translation' }),
        choice('alpha', { kind: 'plugin', plugin: 'Alpha' }),
        choice('insert', { kind: 'basic' }),
        choice('toSpanish', { kind: 'translation' }),
        choice('shorten', { kind: 'aiCommands' }),
      ],
      slots: [],
      unavailableName: () => '',
      groupLabel,
    })

    expect(options.map(({ name, group }) => [group, name])).toEqual([
      ['basic', 'insert'],
      ['translation', 'toEnglish'],
      ['translation', 'toSpanish'],
      ['aiCommands', 'shorten'],
      ['commands', 'script'],
      ['plugin Alpha', 'alpha'],
      ['plugin Zeta', 'zeta'],
    ])
  })

  it('lists the actions of the slots that are not on offer last', () => {
    const disabled = { type: 'command' as const, commandId: 'off' }
    const options = buildMainActionOptions({
      choices: [choice('on', { kind: 'commands' })],
      slots: [disabled, null, { type: 'command', commandId: 'on' }],
      unavailableName: (slot) => `missing ${mainActionOptionId(slot)}`,
      groupLabel,
    })

    expect(options).toEqual([
      { id: 'command:on', name: 'on', group: 'commands' },
      { id: 'command:off', name: 'missing command:off', group: 'unavailable' },
    ])
  })
})

describe('mainActionOptionId', () => {
  it('names transformations by id and translations by language', () => {
    expect(
      mainActionOptionId({
        type: 'transformation',
        transformationId: 'shorten',
      })
    ).toBe('transformation:shorten')
    expect(mainActionOptionId({ type: 'translation', language: 'en-US' })).toBe(
      'translation:en-US'
    )
    expect(mainActionOptionId({ type: 'actionPage', pageIndex: 2 })).toBe(
      'actionPage:2'
    )
  })
})

describe('duplicatesDirectChoice', () => {
  const direct = {
    languages: ['en-US'],
    transformations: [' Rewrite clearly '],
    styling: [' Formal tone '],
  }
  const command = (toolId: string, toolConfig: Record<string, unknown>) => ({
    ...createCommand(toolId),
    toolConfig,
  })

  it('finds commands that do what a language, transformation or style does', () => {
    expect(
      duplicatesDirectChoice(
        command('core.translate', { language: 'en-US' }),
        direct
      )
    ).toBe(true)
    expect(
      duplicatesDirectChoice(
        command('core.transformation', { prompt: 'Rewrite clearly' }),
        direct
      )
    ).toBe(true)
    expect(
      duplicatesDirectChoice(
        command('core.styling', { prompt: 'Formal tone' }),
        direct
      )
    ).toBe(true)
  })

  it('keeps the commands that do something else', () => {
    expect(
      duplicatesDirectChoice(
        command('core.translate', { language: 'de-DE' }),
        direct
      )
    ).toBe(false)
    // an AI command may run other commands: it is never a plain rule
    expect(
      duplicatesDirectChoice(
        command('core.aiTask', { prompt: 'Rewrite clearly' }),
        direct
      )
    ).toBe(false)
    expect(
      duplicatesDirectChoice(
        command('core.transformation', { prompt: 'Other' }),
        direct
      )
    ).toBe(false)
    expect(
      duplicatesDirectChoice(
        command('core.styling', { prompt: 'Other' }),
        direct
      )
    ).toBe(false)
    expect(duplicatesDirectChoice(command('script', {}), direct)).toBe(false)
  })
})
