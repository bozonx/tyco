import { defineStore } from 'pinia'

import type { CoreToolId } from '@tyco/shared'

import { useToastStore } from './toast'
import { translate } from '../lib/i18n'
import { builtinInvocation } from '../lib/invocation/builtin-invocation'
import {
  createInvocationRunner,
  type InvocationRunnerDependencies,
} from '../lib/invocation/invocation-runner'
import type { InvocationOptions } from '../lib/invocation/invocation-types'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menu-modals'
import { useToolsStore } from './tools'

/**
 * What invocations run with, wherever they come from: a command of the library
 * or a built-in action, in the action menu or the command overlay. Call it from
 * a store's setup
 */
export function useInvocationRunnerDependencies(): InvocationRunnerDependencies {
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const toolsStore = useToolsStore()
  const { toastKey, toastText } = useToastStore()

  return {
    tools: toolsStore,
    showToast: (message, type) => {
      toastKey(message, type)
    },
    showText: (text, type) => {
      toastText(text, type)
    },
    hideWindow: () => {
      void ipcStore.callOrNotify('hide_window')
    },
    showError: (messageKey, detail) => {
      toastText(
        detail ? `${translate(messageKey)}: ${detail}` : translate(messageKey),
        'error'
      )
    },
    showResultMenu: (text, sourceText) => {
      menuModalsStore.nextModal(MenuModals.PREVIEW, { text, sourceText })
    },
  }
}

/**
 * Runs the core tools for the flows that gathered their settings themselves: a
 * translation into the picked language, an AI task, a correction, an insertion
 */
export const useInvocationsStore = defineStore('invocations', () => {
  const toolsStore = useToolsStore()
  const runner = createInvocationRunner(useInvocationRunnerDependencies())

  /** Runs the tool on `text` and hands back its result to show */
  const call = (
    toolId: CoreToolId,
    text: string,
    options: InvocationOptions & { toolConfig?: Record<string, unknown> } = {}
  ) => {
    const { toolConfig, ...rest } = options
    return runner.transform(
      builtinInvocation(toolId, toolsStore, translate, toolConfig),
      text,
      rest
    )
  }

  return { call }
})
