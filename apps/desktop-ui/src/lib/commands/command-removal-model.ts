import { isRecord } from '@tyco/shared/value-guards'
import type {
  ActionPageConfig,
  CommandConfig,
  CustomActionSlotConfig,
  MainActionConfig,
  ShortcutSlots,
} from '@tyco/shared'

import { AI_COMMAND_OPERATION_ID } from '../ai-commands/ai-command-config'
import { commandSecretIds, isSecretReferenced } from './command-secrets'

type MenuSlots = ShortcutSlots<MainActionConfig>

const isCommandItem = (
  slot: MainActionConfig | null | undefined,
  commandId: string
): boolean => slot?.type === 'command' && slot.commandId === commandId

export function createCommandRemovalModel(deps: {
  getCommands: () => CommandConfig[]
  getActionPages: () => ActionPageConfig[]
  /** The custom hotkeys; absent when the config has none */
  getCustomActionSlots?: () => CustomActionSlotConfig[] | undefined
  updateCommands: (commands: CommandConfig[]) => void
  updateActionPages: (pages: ActionPageConfig[]) => void
  updateCustomActionSlots?: (slots: CustomActionSlotConfig[]) => void
  removeSecret: (id: string) => Promise<void>
  persist: () => Promise<unknown>
  isSaved: () => boolean
  notifyError: (error: unknown) => void
}) {
  /** Removes the secrets of a removed command that nothing else refers to */
  async function cleanup(command: CommandConfig) {
    await deps.persist()
    const commands = deps.getCommands()
    if (!deps.isSaved() || commands.some((item) => item.id === command.id))
      return
    for (const id of commandSecretIds(command)) {
      // another command may hold a reference copied from this one
      if (!isSecretReferenced(commands, id)) await deps.removeSecret(id)
    }
  }

  /**
   * Removes the command and every reference to it in the config: the action
   * pages, the custom hotkeys and the commands AI commands may run
   */
  function removeCommand(command: CommandConfig) {
    const commands = deps.getCommands()
    const actionPages = deps.getActionPages()
    const referencedInPages = actionPages.some((page) =>
      Object.values(page.slots).some((slot) => isCommandItem(slot, command.id))
    )
    deps.updateCommands(
      removeCommandFromAiCommands(
        commands.filter((item) => item.id !== command.id),
        command.id
      )
    )
    if (referencedInPages) {
      deps.updateActionPages(
        removeCommandFromActionPages(actionPages, command.id)
      )
    }
    const slots = deps.getCustomActionSlots?.()
    if (slots?.some((slot) => isCommandItem(slot.action, command.id))) {
      deps.updateCustomActionSlots?.(
        removeCommandFromCustomActionSlots(slots, command.id)
      )
    }
    if (command.operationId === 'webhook') {
      void cleanup(command).catch(deps.notifyError)
    }
  }

  return { removeCommand }
}

/** The menu without the items that refer to the command */
export function removeCommandReferences(
  slots: MenuSlots,
  commandId: string
): MenuSlots {
  return Object.fromEntries(
    Object.entries(slots).filter(([, slot]) => !isCommandItem(slot, commandId))
  )
}

/** The action pages without the slots that refer to the command */
export function removeCommandFromActionPages(
  pages: readonly ActionPageConfig[],
  commandId: string
): ActionPageConfig[] {
  return pages.map((page) => ({
    ...page,
    slots: removeCommandReferences(page.slots, commandId),
  }))
}

/** The custom hotkeys with the ones that ran the command left without action */
export function removeCommandFromCustomActionSlots(
  slots: readonly CustomActionSlotConfig[],
  commandId: string
): CustomActionSlotConfig[] {
  return slots.map((slot) =>
    isCommandItem(slot.action, commandId) ? { ...slot, action: null } : slot
  )
}

/** The commands with AI commands no longer allowed to run the command */
export function removeCommandFromAiCommands(
  commands: readonly CommandConfig[],
  commandId: string
): CommandConfig[] {
  const isRemoved = (ref: unknown) =>
    isRecord(ref) && ref.sourceKind === 'commands' && ref.toolName === commandId
  return commands.map((command) => {
    const tools = command.operationConfig.tools
    if (
      command.operationId !== AI_COMMAND_OPERATION_ID ||
      !Array.isArray(tools) ||
      !tools.some(isRemoved)
    )
      return command
    return {
      ...command,
      operationConfig: {
        ...command.operationConfig,
        tools: tools.filter((ref) => !isRemoved(ref)),
      },
    }
  })
}
