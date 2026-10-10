import { describe, expect, it } from 'vitest'

import { createCommand } from '../commands/command-config'
import type { RegisteredTool, ToolLookup } from '../tools/tool-types'
import {
  buildMainActionOptions,
  commandGroup,
  type MainActionChoice,
  type MainActionGroup,
  mainActionOptionId,
  pluginActionGroup,
  standardActionGroup,
} from './main-action-options'

const groupLabel = (group: MainActionGroup) =>
  group.kind === 'plugin' ? `plugin ${group.plugin}` : group.kind

describe('main action groups', () => {
  it('puts the translation and the AI task apart from the basic actions', () => {
    expect(standardActionGroup('translation')).toEqual({ kind: 'translation' })
    expect(standardActionGroup('aiTask')).toEqual({ kind: 'aiTask' })
    expect(standardActionGroup('insertIntoWindow')).toEqual({ kind: 'basic' })
    expect(standardActionGroup('askInChat')).toEqual({ kind: 'basic' })
  })

  it('groups a plugin action by its plugin', () => {
    expect(pluginActionGroup('Search:find')).toEqual({
      kind: 'plugin',
      plugin: 'Search',
    })
  })

  it('groups a command by what it does', () => {
    const notes = { owner: { kind: 'plugin', name: 'Notes' } }
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
      kind: 'aiTask',
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
        choice('shorten', { kind: 'aiTask' }),
      ],
      slots: [],
      unavailableName: () => '',
      groupLabel,
    })

    expect(options.map(({ name, group }) => [group, name])).toEqual([
      ['basic', 'insert'],
      ['translation', 'toEnglish'],
      ['translation', 'toSpanish'],
      ['aiTask', 'shorten'],
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
