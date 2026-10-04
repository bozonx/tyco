import { defineStore } from 'pinia'
import { watch } from 'vue'

import { START_MODES } from '@tyco/shared'

import { createCommandLauncherModel } from '../lib/command-launcher/launcher-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import { useCommandRunnerDependencies } from './commands'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'

export const useCommandLauncherStore = defineStore('commandLauncher', () => {
  const ipcStore = useIpcStore()
  const historyStore = useHistoryStore()
  const runner = createCommandRunner(useCommandRunnerDependencies())

  const model = createCommandLauncherModel({
    commands: () => ipcStore.params.userConfig?.commands,
    selectedText: () => ipcStore.params.selectedText,
    run: runner.run,
    saveOutput: async (text) => {
      await historyStore.saveOutput(text)
    },
    logRun: async (record) => {
      await ipcStore.callFunction('logCommandRun', [record])
    },
  })

  // every activation of the overlay starts at the full list
  watch(
    () => ipcStore.params.activationId,
    () => {
      if (ipcStore.params.mode === START_MODES.COMMAND_LAUNCHER) model.reset()
    }
  )

  watch(
    () => ipcStore.params.selectedText,
    (text) => model.selectionArrived(text)
  )

  return model
})
