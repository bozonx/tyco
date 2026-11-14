import { defineStore } from 'pinia'

import type { CoreOperationId } from '@tyco/shared'

import { useToastStore } from './toast'
import { translate } from '../lib/i18n'
import { builtinInvocation } from '../lib/invocation/builtin-invocation'
import {
  createInvocationRunner,
  type InvocationRunnerDependencies,
} from '../lib/invocation/invocation-runner'
import type { InvocationOptions } from '../lib/invocation/invocation-types'
import { translationMetaOf } from '../lib/translation/translation-meta'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menu-modals'
import { useOperationsStore } from './operations'

/**
 * What invocations run with, wherever they come from: a command of the library
 * or a built-in action, in the action menu or the command overlay. Call it from
 * a store's setup
 */
export function useInvocationRunnerDependencies(): InvocationRunnerDependencies {
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const operationsStore = useOperationsStore()
  const { toastKey, toastText } = useToastStore()

  return {
    operations: operationsStore,
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
    showResultMenu: (text, sourceText, meta) => {
      menuModalsStore.nextModal(MenuModals.PREVIEW, {
        text,
        sourceText,
        translationMeta: translationMetaOf(meta),
      })
    },
  }
}

/**
 * Runs the core tools for the flows that gathered their settings themselves: a
 * translation into the picked language, an AI task, a correction, an insertion
 */
export const useInvocationsStore = defineStore('invocations', () => {
  const operationsStore = useOperationsStore()
  const runner = createInvocationRunner(useInvocationRunnerDependencies())

  /** Runs the tool on `text` and hands back its result to show */
  const call = (
    operationId: CoreOperationId,
    text: string,
    options: InvocationOptions & {
      operationConfig?: Record<string, unknown>
    } = {}
  ) => {
    const { operationConfig, ...rest } = options
    return runner.transform(
      builtinInvocation(
        operationId,
        operationsStore,
        translate,
        operationConfig
      ),
      text,
      rest
    )
  }

  return { call }
})
