import type { HistoryApi } from './history-call'
import { createEditorHistoryModel } from './editor-history'
import { createChatHistoryModel } from './chat-history'
export type { HistoryApi } from './history-call'

export function createHistoryModel(
  historyApi: HistoryApi,
  reportError: (error: unknown) => void,
  canRecordEditorHistory?: () => boolean
) {
  return {
    ...createEditorHistoryModel(historyApi, canRecordEditorHistory),
    ...createChatHistoryModel(historyApi, reportError),
  }
}
