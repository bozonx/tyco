import { ref } from 'vue'

import {
  type CommandConfig,
  type MainActionConfig,
  webhookSecretId,
} from '@tyco/shared'

import {
  removeCommandReferences,
  restoreCommand,
  restoreCommandReferences,
  webhookToolConfig,
} from './command-config'

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
}) {
  const removed = ref<RemovedCommand | null>(null)
  function finishRemoval() {
    const entry = removed.value
    removed.value = null
    if (!entry) return
    const { command } = entry
    if (command.toolId === 'webhook' && webhookToolConfig(command).authSecret) {
      // The remaining token is origin-bound if deletion fails.
      void deps.removeSecret(webhookSecretId(command.id)).catch(() => {})
    }
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
