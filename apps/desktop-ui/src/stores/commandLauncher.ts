import { defineStore } from 'pinia'
import { watch } from 'vue'

import { START_MODES } from '@tyco/shared'

import useToast from '../composables/useToast'
import { createCommandLauncherModel } from '../lib/command-launcher/launcher-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import { translate } from '../lib/i18n'
import { useCommandRunnerDependencies } from './commands'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'

export const useCommandLauncherStore = defineStore('commandLauncher', () => {
  const ipcStore = useIpcStore()
  const historyStore = useHistoryStore()
  const runner = createCommandRunner(useCommandRunnerDependencies())
  const { toastText } = useToast()

  const model = createCommandLauncherModel({
    tools: useToolsStore(),
    commands: () => ipcStore.params.userConfig?.commands,
    selectedText: () => ipcStore.params.selectedText,
    run: runner.run,
    saveOutput: async (text) => {
      await historyStore.saveOutput(text)
    },
    logRun: async (record) => {
      await ipcStore.callFunction('logCommandRun', [record])
    },
    commandMissing: (commandId) => {
      toastText(
        translate('commandLauncher.commandMissing', { id: commandId }),
        'error'
      )
    },
  })

  // every activation of the overlay starts at the full list, or at the
  // command of an external call
  watch(
    () => ipcStore.params.activationId,
    () => {
      if (ipcStore.params.mode !== START_MODES.COMMAND_LAUNCHER) return
      const request = ipcStore.params.launcherRequest
      if (request) void model.request(request)
      else model.reset()
    }
  )

  watch(
    () => ipcStore.params.selectedText,
    (text) => {
      void model.selectionArrived(text)
    }
  )

  return model
})
