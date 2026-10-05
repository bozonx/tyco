import type { CommandConfig, MainActionConfig, UserConfig } from '@tyco/shared'

import { PRESETS_KEYS } from '../../types'
import { normalizeMainActions } from '../action-menu/main-actions'
import type {
  DefaultCommand,
  DefaultCommandsContext,
  RegisteredTool,
} from '../tools/tool-types'
import { createCommand, normalizeCommands } from './command-config'

/** The id of a default command: stable, so a deleted one is known */
export function defaultCommandId(toolId: string, localId: string): string {
  return `default:${toolId}:${localId}`
}

/** Marks a tool whose default commands were added */
export function defaultToolMarker(toolId: string): string {
  return `default:${toolId}`
}

/** The parts of the config the seeding changes */
export type SeededConfig = Pick<
  UserConfig,
  'commands' | 'seededCommands' | 'mainActions' | 'mainActionRegistrations'
>

function isToolEnabled(tool: RegisteredTool, userConfig: UserConfig) {
  if (tool.owner.kind !== 'plugin') return true
  const state = userConfig.plugins?.[tool.owner.name] as
    { enabled?: boolean } | undefined
  return state?.enabled !== false
}

function toCommand(
  tool: RegisteredTool,
  id: string,
  preset: DefaultCommand
): CommandConfig {
  const base = createCommand(tool.id, id, tool)
  const command: CommandConfig = {
    ...base,
    name: preset.name,
    phrases: preset.phrases ?? [],
    toolConfig: { ...base.toolConfig, ...preset.toolConfig },
    afterRun: preset.afterRun ?? base.afterRun,
    confirm: preset.confirm ?? 'auto',
    availableIn: { launcher: true, external: true, chat: false },
  }
  if (preset.description) command.description = preset.description
  return command
}

/**
 * Gives the command a menu item: in place of the former plugin item it
 * replaces, which keeps the key of the user, otherwise at its preferred key or
 * the first free slot, unless the user already removed that plugin item
 */
function placeInMenu(
  slots: (MainActionConfig | null)[],
  registrations: string[],
  commandId: string,
  menu: NonNullable<DefaultCommand['menu']>
) {
  const item: MainActionConfig = { type: 'command', commandId }
  if (
    slots.some(
      (slot) => slot?.type === 'command' && slot.commandId === commandId
    )
  ) {
    return
  }
  if (menu.replaces) {
    const index = slots.findIndex(
      (slot) => slot?.type === 'plugin' && slot.actionId === menu.replaces
    )
    if (index >= 0) {
      slots[index] = item
      return
    }
    // the plugin item was placed once and the user took it out of the menu
    if (registrations.includes(menu.replaces)) return
    registrations.push(menu.replaces)
  }
  const preferred = PRESETS_KEYS.indexOf(menu.preferredKey?.toLowerCase() ?? '')
  const index =
    preferred >= 0 && !slots[preferred]
      ? preferred
      : slots.findIndex((slot) => !slot)
  if (index >= 0) slots[index] = item
}

/**
 * Adds the default commands of the tools that have not had them yet, with their
 * menu items. Each tool is seeded once: a default command the user deleted, or
 * one a tool would add later, does not come back. `null` when there is nothing
 * to add
 */
export function seedDefaultCommands(
  userConfig: UserConfig,
  tools: readonly RegisteredTool[],
  t: DefaultCommandsContext['t']
): SeededConfig | null {
  const seeded = new Set(userConfig.seededCommands ?? [])
  const commands = normalizeCommands(userConfig.commands)
  const slots = normalizeMainActions(userConfig.mainActions)
  const registrations = [...(userConfig.mainActionRegistrations ?? [])]
  let changed = false

  for (const tool of tools) {
    const marker = defaultToolMarker(tool.id)
    if (!tool.defaultCommands || seeded.has(marker)) continue
    if (!isToolEnabled(tool, userConfig)) continue
    for (const preset of tool.defaultCommands({ userConfig, t })) {
      const id = defaultCommandId(tool.id, preset.id)
      if (seeded.has(id)) continue
      seeded.add(id)
      if (commands.some((command) => command.id === id)) continue
      commands.push(toCommand(tool, id, preset))
      if (preset.menu) placeInMenu(slots, registrations, id, preset.menu)
    }
    seeded.add(marker)
    changed = true
  }

  if (!changed) return null
  return {
    commands,
    seededCommands: [...seeded],
    mainActions: slots,
    mainActionRegistrations: registrations,
  }
}

export interface DefaultCommandsSyncDependencies {
  tools: () => readonly RegisteredTool[]
  /** The config as saved now: this window may have missed changes */
  loadUserConfig: () => Promise<UserConfig | null>
  saveUserConfig: (userConfig: UserConfig) => Promise<boolean>
  t: DefaultCommandsContext['t']
}

/**
 * Seeds the default commands from the quick window, which knows the plugin
 * tools and always exists; one seeding runs at a time, and a check asked for
 * meanwhile runs after it
 */
export function createDefaultCommandsSync(
  deps: DefaultCommandsSyncDependencies
) {
  let running: Promise<void> | null = null
  let again = false

  const seed = async () => {
    const tools = deps.tools()
    if (!tools.some((tool) => tool.defaultCommands)) return
    const userConfig = await deps.loadUserConfig()
    if (!userConfig) return
    const seeded = seedDefaultCommands(userConfig, tools, deps.t)
    if (seeded) await deps.saveUserConfig({ ...userConfig, ...seeded })
  }

  const check = async (): Promise<void> => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        try {
          await seed()
        } catch {
          // the next change of the tools tries again
        }
      } while (again)
    })()
    try {
      await running
    } finally {
      running = null
    }
  }

  return { check }
}
