import { clientLogger } from '../lib/logger'
import { createExternalJobAdapter } from '../lib/commands/external-job-adapter'
import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'

import { ActivationMode } from '@tyco/shared'

import { useToastStore } from './toast'
import { createCommandLauncherModel } from '../lib/command-launcher/launcher-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import { translate } from '../lib/i18n/index'
import { useInvocationRunnerDependencies } from './invocations'
import { useHistoryStore } from './history'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'

export const useCommandLauncherStore = defineStore('commandLauncher', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const historyStore = useHistoryStore()
  const runner = createCommandRunner(useInvocationRunnerDependencies())
  const { toastText } = useToastStore()

  const model = createCommandLauncherModel({
    reportError: (error) =>
      clientLogger.error(
        'Could not persist command run',
        error,
        'command-launcher'
      ),
    tools: useToolsStore(),
    commands: () => desktopStore.userConfig?.commands,
    launcherPages: () => desktopStore.userConfig.launcherPages,
    selectedText: () => desktopStore.desktopState.selectedText,
    run: runner.run,
    ...createExternalJobAdapter({
      call: ipcStore.call,
      selectionFailed: (message) =>
        toastText(message ?? translate('toast.commandFailed'), 'error'),
    }),
    saveOutput: async (text) => {
      await historyStore.saveOutput(text)
    },
    logRun: async (record) => {
      const result = await ipcStore.call('log_command_run', { record })
      if (!result.success) throw new Error(result.error)
    },
    replaceSelection: async (command) => {
      const result = await ipcStore.call('replace_selection_with_command', {
        commandId: command.id,
      })
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
    () => desktopStore.desktopState.activationId,
    () => {
      if (desktopStore.desktopState.mode !== ActivationMode.COMMAND_LAUNCHER)
        return
      const request = desktopStore.desktopState.launcherRequest
      if (request) void model.request(request)
      else {
        model.reset()
        const pageId = desktopStore.desktopState.launcherPageId
        model.setPage(
          Math.max(
            0,
            desktopStore.userConfig.launcherPages.findIndex(
              (page) => page.id === pageId
            )
          )
        )
      }
    }
  )

  watch(
    () => desktopStore.desktopState.selectedText,
    (text) => {
      void model.selectionArrived(text)
    }
  )

  watch(
    () => desktopStore.desktopState.isWindowShown,
    (shown) => {
      if (!shown && model.stage.value.kind === 'prepare')
        model.dismissExternal()
    }
  )

  onScopeDispose(model.dispose)
  return model
})
