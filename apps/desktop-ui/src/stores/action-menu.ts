import { defineStore } from 'pinia'
import { ActivationMode, APP_CONFIG } from '@tyco/shared'

import {
  type ActionItem,
  createActionMenuModel,
} from '../lib/action-menu/action-menu-model'
import { isMainActionVisible } from '../lib/action-menu/main-actions'
import { useInvocationRunnerDependencies } from './invocations'
import { useCorrectionWorkflowStore } from './correction-workflow'
import { useHistoryStore } from './history'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menu-modals'

export type { ActionItem }

export const useActionMenuStore = defineStore('actionMenu', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const correctionWorkflowStore = useCorrectionWorkflowStore()

  return createActionMenuModel({
    saveOutput: async (text: string) => {
      await historyStore.saveOutput(text)
    },
    openAiTaskModal: (text: string, taskId?: string) => {
      menuModalsStore.nextModal(MenuModals.AI_TASK, { text, taskId })
    },
    openTranslateModal: (text: string, language?: string) => {
      menuModalsStore.nextModal(MenuModals.TRANSLATE, { text, language })
    },
    startCorrection: (text, extra) =>
      // the result replaces the text in the editor as well
      correctionWorkflowStore.start(text, {
        isEditorButtonVisible: true,
        ...extra,
      }),
    minCorrectionLength: () => APP_CONFIG.minCorrectionLength,
    openLauncherPage: async (pageId, text) => {
      await ipcStore.call('activate_mode', {
        mode: ActivationMode.COMMAND_LAUNCHER,
        launcherPageId: pageId,
        text,
      })
    },
    launcherPages: () => desktopStore.userConfig.launcherPages,
    isMainActionVisible: (action) =>
      isMainActionVisible(action, desktopStore.userConfig.isInDevelopment),
    mainActions: () => desktopStore.userConfig.mainActions,
    commands: () => desktopStore.userConfig.commands,
    aiTasks: () => desktopStore.userConfig.aiTasks.items,
    ...useInvocationRunnerDependencies(),
  })
})
