import type {
  CommandConfig,
  MainActionConfig,
  StandardActionId,
} from '@tyco/shared'

import { commandTool } from '../commands/command-runtime'
import type { ToolLookup } from '../tools/tool-types'

/**
 * A group of the main action picker, by what the action does for the user
 * rather than by how it is made: a translation command sits with the
 * translation, a plugin tool with the other actions of its plugin
 */
export type MainActionGroup =
  | { kind: 'basic' | 'translation' | 'aiTask' | 'commands' | 'unavailable' }
  | { kind: 'plugin'; plugin: string }

/** An action that can go to a slot of the main menu */
export interface MainActionChoice {
  config: MainActionConfig
  name: string
  group: MainActionGroup
}

export interface MainActionOption {
  id: string
  name: string
  group: string
}

const GROUP_ORDER: MainActionGroup['kind'][] = [
  'basic',
  'translation',
  'aiTask',
  'commands',
  'plugin',
  'unavailable',
]

export function mainActionOptionId(
  item: MainActionConfig | null | undefined
): string {
  if (!item) return ''
  if (item.type === 'launcherPage') return `launcherPage:${item.page}`
  if (item.type === 'command') return `command:${item.commandId}`
  if (item.type === 'aiTask') return `aiTask:${item.taskId}`
  if (item.type === 'translation') return `translation:${item.language}`
  return `${item.type}:${item.actionId}`
}

export function standardActionGroup(id: StandardActionId): MainActionGroup {
  if (id === 'translation' || id === 'aiTask') return { kind: id }
  return { kind: 'basic' }
}

/** A plugin action is registered as `<plugin>:<action>` */
export function pluginActionGroup(actionId: string): MainActionGroup {
  const separator = actionId.indexOf(':')
  return {
    kind: 'plugin',
    plugin: separator > 0 ? actionId.slice(0, separator) : actionId,
  }
}

export function commandGroup(
  command: CommandConfig,
  tools: ToolLookup
): MainActionGroup {
  if (command.toolId === 'core.translate') return { kind: 'translation' }
  if (command.toolId === 'core.aiTask') return { kind: 'aiTask' }
  const owner = commandTool(command, tools)?.owner
  if (owner?.kind === 'plugin')
    return { kind: 'plugin', plugin: owner.pluginId }
  return { kind: 'commands' }
}

/**
 * Whether the command does just what an item of the picker does already: a
 * translation into one of the translation languages, or the rule of an AI task.
 * Such commands are made once from the settings, see `defaultCommands`
 */
export function duplicatesDirectChoice(
  command: CommandConfig,
  direct: { languages: readonly string[]; rules: readonly string[] }
): boolean {
  const value = (key: string) => {
    const field = command.toolConfig[key]
    return typeof field === 'string' ? field.trim() : ''
  }
  if (command.toolId === 'core.translate') {
    return direct.languages.includes(value('language'))
  }
  if (command.toolId === 'core.aiTask') {
    return direct.rules.some((rule) => rule.trim() === value('prompt'))
  }
  return false
}

/**
 * The options of the picker, group by group: the choices on offer, then the
 * actions of the slots that are not on offer, e.g. a disabled command, so a
 * slot always shows what it holds. Plugin groups are sorted by their label; the
 * order within a group is the order of the choices.
 */
export function buildMainActionOptions(deps: {
  choices: readonly MainActionChoice[]
  slots: readonly (MainActionConfig | null)[]
  unavailableName: (slot: MainActionConfig) => string
  groupLabel: (group: MainActionGroup) => string
}): MainActionOption[] {
  const entries = deps.choices.map((choice) => ({
    id: mainActionOptionId(choice.config),
    name: choice.name,
    group: choice.group,
  }))
  for (const slot of deps.slots) {
    const id = mainActionOptionId(slot)
    if (slot && !entries.some((entry) => entry.id === id)) {
      entries.push({
        id,
        name: deps.unavailableName(slot),
        group: { kind: 'unavailable' },
      })
    }
  }

  const labeled = entries.map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    group: deps.groupLabel(entry.group),
    rank: GROUP_ORDER.indexOf(entry.group.kind),
    index,
  }))
  labeled.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.rank === GROUP_ORDER.indexOf('plugin')
        ? a.group.localeCompare(b.group)
        : 0) ||
      a.index - b.index
  )
  return labeled.map(({ id, name, group }) => ({ id, name, group }))
}
