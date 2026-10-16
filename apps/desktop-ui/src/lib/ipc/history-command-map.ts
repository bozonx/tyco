import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { HistoryFunctions } from './functions/history'
import type { DomainCommandMap } from './command-types'

export function createHistoryCommandMap(): DomainCommandMap<
  keyof HistoryFunctions
> {
  return {
    getEditorHistory: { command: DESKTOP_COMMANDS.GET_EDITOR_HISTORY },
    listChats: {
      command: DESKTOP_COMMANDS.LIST_CHATS,
      buildArgs: ([profileId]) =>
        ({ profileId }) satisfies DesktopCommandArgs<'list_chats'>,
    },
    getChat: {
      command: DESKTOP_COMMANDS.GET_CHAT,
      buildArgs: ([id, profileId]) =>
        ({ id, profileId }) satisfies DesktopCommandArgs<'get_chat'>,
    },
    saveEditorHistory: {
      command: DESKTOP_COMMANDS.SAVE_EDITOR_HISTORY,
      buildArgs: ([entry]) =>
        ({ entry }) satisfies DesktopCommandArgs<'save_editor_history'>,
    },
    setEditorHistoryResult: {
      command: DESKTOP_COMMANDS.SET_EDITOR_HISTORY_RESULT,
      buildArgs: ([id, result]) =>
        ({
          id,
          result,
        }) satisfies DesktopCommandArgs<'set_editor_history_result'>,
    },
    restoreEditorHistoryItem: {
      command: DESKTOP_COMMANDS.RESTORE_EDITOR_HISTORY_ITEM,
      buildArgs: ([item]) =>
        ({ item }) satisfies DesktopCommandArgs<'restore_editor_history_item'>,
    },
    saveChat: {
      command: DESKTOP_COMMANDS.SAVE_CHAT,
      buildArgs: ([chat, profileId]) =>
        ({ chat, profileId }) satisfies DesktopCommandArgs<'save_chat'>,
    },
    renameChat: {
      command: DESKTOP_COMMANDS.RENAME_CHAT,
      buildArgs: ([id, title, profileId]) =>
        ({ id, title, profileId }) satisfies DesktopCommandArgs<'rename_chat'>,
    },
    searchChats: {
      command: DESKTOP_COMMANDS.SEARCH_CHATS,
      buildArgs: ([query, profileId]) =>
        ({ query, profileId }) satisfies DesktopCommandArgs<'search_chats'>,
    },
    removeFromEditorHistory: {
      command: DESKTOP_COMMANDS.REMOVE_FROM_EDITOR_HISTORY,
      buildArgs: ([id]) =>
        ({ id }) satisfies DesktopCommandArgs<'remove_from_editor_history'>,
    },
    deleteChat: {
      command: DESKTOP_COMMANDS.DELETE_CHAT,
      buildArgs: ([id, profileId]) =>
        ({ id, profileId }) satisfies DesktopCommandArgs<'delete_chat'>,
    },
    clearEditorHistory: { command: DESKTOP_COMMANDS.CLEAR_EDITOR_HISTORY },
    clearChats: {
      command: DESKTOP_COMMANDS.CLEAR_CHATS,
      buildArgs: ([profileId]) =>
        ({ profileId }) satisfies DesktopCommandArgs<'clear_chats'>,
    },
  }
}
