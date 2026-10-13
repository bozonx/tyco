import { ref } from 'vue'

import { type CommandConfig, type MainActionConfig } from '@tyco/shared'

import { webhookToolConfig } from './command-config'

interface RemovedCommand {
  command: CommandConfig
  index: number
  mainActions?: (MainActionConfig | null)[]
}

/** Undo restores references without overwriting edits made after removal. */
export function createCommandRemovalModel(deps: {
  getCommands: () => CommandConfig[]
  getMainActions: () => (MainActionConfig | null)[]
  updateCommands: (commands: CommandConfig[]) => void
  updateMainActions: (actions: (MainActionConfig | null)[]) => void
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
  async function cleanup(command: CommandConfig) {
    await deps.persist()
    if (
      !deps.isSaved() ||
      deps.getCommands().some((item) => item.id === command.id)
    )
      return
    const tool = webhookToolConfig(command)
    const ids = new Set(
      Object.values(tool.headers ?? {}).flatMap((value) =>
        value.startsWith('tyco-secret:')
          ? [value.slice('tyco-secret:'.length)]
          : []
      )
    )
    if (tool.authSecretId) ids.add(tool.authSecretId)
    for (const id of ids) await deps.removeSecret(id)
  }
  function removeCommand(command: CommandConfig) {
    finishRemoval()
    const commands = deps.getCommands()
    const mainActions = deps.getMainActions()
    const referenced = mainActions.some(
      (slot) => slot?.type === 'command' && slot.commandId === command.id
    )
    removed.value = {
      command,
      index: commands.findIndex((item) => item.id === command.id),
      mainActions: referenced ? [...mainActions] : undefined,
    }
    deps.updateCommands(commands.filter((item) => item.id !== command.id))
    if (referenced)
      deps.updateMainActions(removeCommandReferences(mainActions, command.id))
  }
  function undoRemove() {
    const entry = removed.value
    if (!entry) return
    removed.value = null
    deps.updateCommands(
      restoreCommand(deps.getCommands(), entry.command, entry.index)
    )
    if (entry.mainActions)
      deps.updateMainActions(
        restoreCommandReferences(
          deps.getMainActions(),
          entry.mainActions,
          entry.command.id
        )
      )
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
  slots: readonly (MainActionConfig | null)[],
  previous: readonly (MainActionConfig | null)[],
  commandId: string
): (MainActionConfig | null)[] {
  return slots.map((slot, index) => {
    const before = previous[index]
    return slot === null &&
      before?.type === 'command' &&
      before.commandId === commandId
      ? before
      : slot
  })
}

/** The menu without the items that refer to the command */
export function removeCommandReferences(
  slots: readonly (MainActionConfig | null)[],
  commandId: string
): (MainActionConfig | null)[] {
  return slots.map((slot) =>
    slot?.type === 'command' && slot.commandId === commandId ? null : slot
  )
}
