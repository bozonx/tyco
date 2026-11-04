import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import type { EditorHistoryOperation } from '@tyco/shared'

import { createQuickInputModel } from '../lib/quick-input/quick-input-model'
import { useDesktopStore } from './desktop'
import { useHistoryStore } from './history'
import { useToastStore } from './toast'

export const useQuickInputStore = defineStore('quickInput', () => {
  const model = createQuickInputModel()
  const desktop = useDesktopStore()
  const history = useHistoryStore()
  const toast = useToastStore()
  // the history is the only store of the input; see `createQuickInputModel`
  const session = history.createInputSession(
    () => toast.toastKey('history.operationFailed', 'error'),
    'quickInput'
  )
  watch(model.value, session.update, { flush: 'sync' })

  /** The input is done with: the next text starts a new history record */
  const finish = () => {
    session.end()
    model.finish()
  }
  // a text inserted or copied from the quick input, or from its actions step,
  // finishes it; a failed or cancelled insertion leaves the text in place
  const stopOutput = history.onOutput(() => {
    if (desktop.desktopState.mode === 'quickInput') finish()
  })

  onScopeDispose(() => {
    stopOutput()
    session.dispose()
  })
  return {
    ...model,
    flushHistory: session.flush,
    saveSource: (text: string, operation: EditorHistoryOperation) =>
      session.complete(text, 'source', operation),
    finish,
    clear: () => {
      session.end()
      model.clear()
    },
    discard: () => {
      session.end()
      model.discard()
    },
  }
})
