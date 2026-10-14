import type { HistoryApi } from './history-call'
import { createEditorHistoryModel } from './editor-history'
import { createChatHistoryModel } from './chat-history'
export type { HistoryApi } from './history-call'

export function createHistoryModel(historyApi: HistoryApi) {
  return {
    ...createEditorHistoryModel(historyApi),
    ...createChatHistoryModel(historyApi),
  }
}
