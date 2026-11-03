import type { HistoryApi } from './history-call'
import { createEditorHistoryModel } from './editor-history'
import { createChatHistoryModel } from './chat-history'
export type { HistoryApi } from './history-call'

export function createHistoryModel(
  historyApi: HistoryApi,
  reportError: (error: unknown) => void,
  canRecordEditorHistory?: () => boolean
) {
  const inputFlushes = new Set<() => Promise<unknown>>()
  return {
    registerInputFlush: (flush: () => Promise<unknown>) => {
      inputFlushes.add(flush)
      return () => {
        inputFlushes.delete(flush)
      }
    },
    flushInputs: async () => {
      const results = await Promise.allSettled(
        [...inputFlushes].map((flush) => flush())
      )
      return results.every((result) => result.status === 'fulfilled')
    },
    ...createEditorHistoryModel(historyApi, canRecordEditorHistory),
    ...createChatHistoryModel(historyApi, reportError),
  }
}
