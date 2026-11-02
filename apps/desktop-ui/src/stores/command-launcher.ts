import { clientLogger } from '../lib/logger'
import { createExternalJobAdapter } from '../lib/commands/external-job-adapter'
import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'

import { ActivationMode } from '@tyco/shared'

import { useToastStore } from './toast'
import { savePromptAsCommand } from '../lib/ai-commands/ai-command-config'
import { createCommandLauncherModel } from '../lib/command-launcher/launcher-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import { commandLabel } from '../lib/commands/command-runtime'
import { translate } from '../lib/i18n/index'
import { resultOrThrow } from '../lib/ipc/ipc-model'
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
    commands: () => desktopStore.userConfig.commands,
    launcherPages: () => desktopStore.userConfig.launcherPages,
    selectedText: () => desktopStore.desktopState.selectedText,
    run: runner.run,
    ...createExternalJobAdapter({
      call: ipcStore.call,
      selectionFailed: (message) =>
        toastText(message ?? translate('toast.commandFailed'), 'error'),
      reportError: (error) =>
        clientLogger.error(
          'Could not finish external job',
          error,
          'command-launcher'
        ),
    }),
    saveOutput: async (text) => {
      await historyStore.saveOutput(text)
    },
    logRun: async (record) => {
      resultOrThrow(await ipcStore.call('log_command_run', { record }))
    },
    replaceSelection: async (command) => {
      const result = await ipcStore.call('replace_selection_with_command', {
        commandId: command.id,
      })
      if (!result.success) {
        toastText(result.error ?? translate('toast.commandFailed'), 'error')
      }
      return result.success
    },
    commandUnavailable: (command, reasonKey) => {
      toastText(`${commandLabel(command)}: ${translate(reasonKey)}`, 'warn')
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
        let pageIdx = desktopStore.userConfig.launcherPages.findIndex(
          (page) => page.id === pageId
        )
        if (pageIdx < 0 && pageId) {
          if (pageId === 'page-2') pageIdx = 1
          else if (pageId === 'page-3') pageIdx = 2
          if (pageIdx >= desktopStore.userConfig.launcherPages.length) {
            const pages = [...desktopStore.userConfig.launcherPages]
            while (pages.length <= pageIdx) {
              const idx = pages.length
              const id =
                idx === 1
                  ? 'page-2'
                  : idx === 2
                    ? 'page-3'
                    : crypto.randomUUID()
              pages.push({ id, inputMode: 'selection', slots: {} })
            }
            void desktopStore.updateUserConfig({ launcherPages: pages })
          }
        }
        model.setPage(Math.max(0, pageIdx))
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

  /** Saves a request typed in the search as an AI command */
  const savePrompt = async (prompt: string): Promise<boolean> => {
    const saved = savePromptAsCommand(
      desktopStore.userConfig,
      prompt,
      model.pageIndex.value
    )
    if (!saved.isAdded) {
      toastText(translate('commandLauncher.promptSavedAlready'), 'info')
      return false
    }
    const result = await desktopStore.updateUserConfig({
      commands: saved.commands,
      launcherPages: saved.launcherPages,
    })
    if (!result.success) {
      toastText(translate('toast.desktopCommandFailed'), 'error')
      return false
    }
    toastText(translate('commandLauncher.promptSaved'), 'success')
    return true
  }

  onScopeDispose(model.dispose)
  return { ...model, savePrompt }
})
