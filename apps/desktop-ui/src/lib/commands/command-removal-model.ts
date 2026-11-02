import { ref } from 'vue'

import {
  SHORTCUT_SLOT_KEYS,
  type ActionPageConfig,
  type CommandConfig,
  type MainActionConfig,
  type ShortcutSlots,
} from '@tyco/shared'

import { commandSecretIds, isSecretReferenced } from './command-secrets'

interface RemovedCommand {
  command: CommandConfig
  index: number
  actionPages?: ActionPageConfig[]
}

type MenuSlots = ShortcutSlots<MainActionConfig>

const isCommandItem = (
  slot: MainActionConfig | undefined,
  commandId: string
): boolean => slot?.type === 'command' && slot.commandId === commandId

/** Undo restores references without overwriting edits made after removal. */
export function createCommandRemovalModel(deps: {
  getCommands: () => CommandConfig[]
  getActionPages: () => ActionPageConfig[]
  updateCommands: (commands: CommandConfig[]) => void
  updateActionPages: (pages: ActionPageConfig[]) => void
  removeSecret: (id: string) => Promise<void>
  persist: () => Promise<unknown>
  isSaved: () => boolean
  notifyError: (error: unknown) => void
}) {
  const removed = ref<RemovedCommand | null>(null)

  function finishRemoval() {
    const entry = removed.value
    removed.value = null
    if (!entry) return
    const { command } = entry
    if (command.toolId === 'webhook') {
      void cleanup(command).catch(deps.notifyError)
    }
  }

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

  function removeCommand(command: CommandConfig) {
    finishRemoval()
    const commands = deps.getCommands()
    const actionPages = deps.getActionPages()
    const referencedInPages = actionPages.some((page) =>
      Object.values(page.slots).some((slot) => isCommandItem(slot, command.id))
    )
    removed.value = {
      command,
      index: commands.findIndex((item) => item.id === command.id),
      actionPages: referencedInPages ? [...actionPages] : undefined,
    }
    deps.updateCommands(commands.filter((item) => item.id !== command.id))
    if (referencedInPages) {
      deps.updateActionPages(
        removeCommandFromActionPages(actionPages, command.id)
      )
    }
  }

  function undoRemove() {
    const entry = removed.value
    if (!entry) return
    removed.value = null
    deps.updateCommands(
      restoreCommand(deps.getCommands(), entry.command, entry.index)
    )
    if (entry.actionPages) {
      deps.updateActionPages(
        restoreCommandInActionPages(
          deps.getActionPages(),
          entry.actionPages,
          entry.command.id
        )
      )
    }
  }

  return { removed, removeCommand, undoRemove, finishRemoval }
}

/** The library with a removed command put back where it was */
export function restoreCommand(
  commands: readonly CommandConfig[],
  command: CommandConfig,
  index: number
): CommandConfig[] {
  if (commands.some((item) => item.id === command.id)) return [...commands]
  const next = [...commands]
  next.splice(Math.min(Math.max(index, 0), next.length), 0, command)
  return next
}

/**
 * The menu with the items of a removed command put back: the slots that held it
 * before and are still empty
 */
export function restoreCommandReferences(
  slots: MenuSlots,
  previous: MenuSlots,
  commandId: string
): MenuSlots {
  const next = { ...slots }
  for (const key of SHORTCUT_SLOT_KEYS) {
    const before = previous[key]
    if (!next[key] && before && isCommandItem(before, commandId))
      next[key] = before
  }
  return next
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

/** The action pages with restored command slots where still unassigned */
export function restoreCommandInActionPages(
  currentPages: readonly ActionPageConfig[],
  previousPages: readonly ActionPageConfig[],
  commandId: string
): ActionPageConfig[] {
  return currentPages.map((page, index) => {
    const before = previousPages[index]
    if (!before) return page
    return {
      ...page,
      slots: restoreCommandReferences(page.slots, before.slots, commandId),
    }
  })
}
