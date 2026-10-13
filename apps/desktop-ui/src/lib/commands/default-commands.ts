import type { CommandConfig, MainActionConfig, UserConfig } from '@tyco/shared'

import { SHORTCUT_SLOT_KEYS } from '../../types'
import { normalizeMainActions } from '../action-menu/main-actions'
import type {
  DefaultCommand,
  DefaultCommandsContext,
  RegisteredTool,
} from '../tools/tool-types'
import {
  createCommand,
  launcherAfterRunFromOutput,
  normalizeCommands,
} from './command-config'

/** The id of a default command: stable, so a deleted one is known */
export function defaultCommandId(toolId: string, localId: string): string {
  return `default:${toolId}:${localId}`
}

/** The parts of the config the seeding changes */
export type SeededConfig = Pick<
  UserConfig,
  'commands' | 'registrationState' | 'mainActions'
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
    launcherAfterRun:
      preset.afterRun === undefined
        ? base.launcherAfterRun
        : launcherAfterRunFromOutput(preset.afterRun),
    availableIn: { external: false, chat: false },
  }
  if (preset.description) command.description = preset.description
  return command
}

/** Places a new command in its preferred free menu slot. */
function placeInMenu(
  slots: (MainActionConfig | null)[],
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
  const preferred = SHORTCUT_SLOT_KEYS.indexOf(
    menu.preferredKey?.toLowerCase() ?? ''
  )
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
  const seeded = new Set(userConfig.registrationState?.seededCommandIds ?? [])
  const seededTools = new Set(userConfig.registrationState?.seededToolIds ?? [])
  const commands = normalizeCommands(userConfig.commands)
  const slots = normalizeMainActions(userConfig.mainActions)
  const registrations = [
    ...(userConfig.registrationState?.reviewedMainActionIds ?? []),
  ]
  let changed = false

  for (const tool of tools) {
    if (!tool.defaultCommands || seededTools.has(tool.id)) continue
    if (!isToolEnabled(tool, userConfig)) continue
    for (const preset of tool.defaultCommands({ userConfig, t })) {
      const id = defaultCommandId(tool.id, preset.id)
      if (seeded.has(id)) continue
      seeded.add(id)
      if (commands.some((command) => command.id === id)) continue
      commands.push(toCommand(tool, id, preset))
      if (preset.menu) placeInMenu(slots, id, preset.menu)
    }
    seededTools.add(tool.id)
    changed = true
  }

  if (!changed) return null
  return {
    commands,
    registrationState: {
      seededCommandIds: [...seeded],
      seededToolIds: [...seededTools],
      reviewedMainActionIds: registrations,
    },
    mainActions: slots,
  }
}

export interface DefaultCommandsSyncDependencies {
  tools: () => readonly RegisteredTool[]
  /** The config as saved now: this window may have missed changes */
  loadUserConfig: () => Promise<UserConfig | null>
  saveUserConfig: (
    userConfig: UserConfig,
    baseConfig: UserConfig
  ) => Promise<boolean>
  t: DefaultCommandsContext['t']
  reportError?: (error: unknown) => void
  retryMs?: number
  maxRetries?: number
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
  let disposed = false
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const seed = async () => {
    const tools = deps.tools()
    if (!tools.some((tool) => tool.defaultCommands)) return
    const userConfig = await deps.loadUserConfig()
    if (disposed) return
    if (!userConfig)
      throw new Error('Could not load the config for default commands')
    const seeded = seedDefaultCommands(userConfig, tools, deps.t)
    if (
      seeded &&
      !(await deps.saveUserConfig({ ...userConfig, ...seeded }, userConfig))
    )
      throw new Error('Could not save default commands')
  }

  const check = async (): Promise<void> => {
    if (disposed) return
    clearTimeout(retryTimer)
    retryTimer = undefined
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        try {
          await seed()
          failures = 0
          clearTimeout(retryTimer)
          retryTimer = undefined
        } catch (error) {
          if (disposed) return
          deps.reportError?.(error)
          if (failures < (deps.maxRetries ?? 3)) {
            const delay = Math.min(
              (deps.retryMs ?? 1000) * 2 ** failures++,
              30000
            )
            retryTimer = setTimeout(() => {
              retryTimer = undefined
              void check()
            }, delay)
          }
        }
      } while (again && !disposed)
    })()
    try {
      await running
    } finally {
      running = null
    }
  }

  const dispose = () => {
    disposed = true
    again = false
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  return { check, dispose }
}
