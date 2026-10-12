import { createExternalJobAdapter } from '../lib/commands/external-job-adapter'
import { defineStore } from 'pinia'
import { watch } from 'vue'

import { START_MODES } from '@tyco/shared'

import useToast from '../composables/use-toast'
import { createCommandLauncherModel } from '../lib/command-launcher/launcher-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import { translate } from '../lib/i18n/index'
import { useInvocationRunnerDependencies } from './invocations'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'

export const useCommandLauncherStore = defineStore('commandLauncher', () => {
  const ipcStore = useIpcStore()
  const historyStore = useHistoryStore()
  const runner = createCommandRunner(useInvocationRunnerDependencies())
  const { toastText } = useToast()

  const model = createCommandLauncherModel({
    tools: useToolsStore(),
    commands: () => ipcStore.params.userConfig?.commands,
    launcherPages: () => ipcStore.params.userConfig?.launcherPages,
    launcherCommands: () => ipcStore.params.userConfig?.launcherCommands,
    launcherPagesWithoutText: () =>
      ipcStore.params.userConfig?.launcherPagesWithoutText,
    selectedText: () => ipcStore.params.selectedText,
    run: runner.run,
    ...createExternalJobAdapter({
      callFunction: ipcStore.callFunction,
      selectionFailed: (message) =>
        toastText(message ?? translate('toast.commandFailed'), 'error'),
    }),
    saveOutput: async (text) => {
      await historyStore.saveOutput(text)
    },
    logRun: async (record) => {
      await ipcStore.callFunction('logCommandRun', [record])
    },
    replaceSelection: async (command) => {
      const result = await ipcStore.callFunction(
        'replaceSelectionWithCommand',
        [command.id]
      )
      if (!result.success) {
        toastText(result.error ?? translate('toast.commandFailed'), 'error')
      }
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
      else {
        model.reset()
        model.setPage(ipcStore.params.launcherPage ?? 0)
      }
    }
  )

  watch(
    () => ipcStore.params.selectedText,
    (text) => {
      void model.selectionArrived(text)
    }
  )

  watch(
    () => ipcStore.params.isWindowShown,
    (shown) => {
      if (!shown && model.stage.value.kind === 'prepare')
        model.dismissExternal()
    }
  )

  return model
})
