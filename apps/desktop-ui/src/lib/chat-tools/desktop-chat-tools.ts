import {
  type AiFileChangePreview,
  type AiFileRoot,
  type AiFileToolOutput,
  type AiFileToolRequest,
  type ProfileMemoryChange,
  type ProfileMemoryMode,
  type ProfileMemorySearchResult,
  type ProfileMemoryTopic,
  type ProfileToolSettings,
} from '@tyco/shared'

import { createChatToolsSession } from './chat-tools-session'
import {
  createDebugChatToolProvider,
  isDebugChatToolsEnabled,
} from './debug-chat-tools'
import { readDocumentText } from './file-document-text'
import { createFileToolProvider } from './file-tools'
import { createMemoryToolProvider } from './memory-tools'

export interface DesktopChatToolsInvoke {
  (
    command: 'list_ai_file_roots',
    args: { profileId: string }
  ): Promise<AiFileRoot[]>
  (
    command: 'run_ai_file_tool',
    args: { profileId: string; request: AiFileToolRequest }
  ): Promise<AiFileToolOutput>
  (
    command: 'preview_ai_file_change',
    args: { profileId: string; request: AiFileToolRequest }
  ): Promise<AiFileChangePreview>
  (
    command: 'read_ai_file_bytes',
    args: { profileId: string; path: string }
  ): Promise<ArrayBuffer | number[]>
  (
    command: 'read_ai_profile_memory',
    args: { profileId: string; file: string }
  ): Promise<string>
  (
    command: 'search_ai_profile_memory',
    args: { profileId: string; query: string }
  ): Promise<ProfileMemorySearchResult[]>
  (
    command: 'add_ai_profile_memory_fact',
    args: {
      profileId: string
      chatId?: string | null
      file: string
      fact: string
    }
  ): Promise<ProfileMemoryChange>
  (
    command: 'replace_ai_profile_memory',
    args: {
      profileId: string
      chatId?: string | null
      file: string
      oldText: string
      newText: string
    }
  ): Promise<ProfileMemoryChange>
  (
    command: 'rewrite_ai_profile_memory',
    args: {
      profileId: string
      chatId?: string | null
      file: string
      content: string
    }
  ): Promise<ProfileMemoryChange>
  (
    command: 'list_ai_profile_memory_topics',
    args: { profileId: string }
  ): Promise<ProfileMemoryTopic[]>
}

export interface DesktopChatToolsDependencies {
  profileId: string | null
  invoke: DesktopChatToolsInvoke
  canUseTools: () => boolean
  getMemoryMode?: () => ProfileMemoryMode | undefined
  getChatId?: () => string | null | undefined
  warn: (message: string) => void
  extractDocumentText?: typeof readDocumentText
  isDebugEnabled?: () => boolean
}

/**
 * Wires desktop file tools, memory tools, and debug tools into a per-chat tool
 * session.
 */
export function createDesktopChatTools(deps: DesktopChatToolsDependencies) {
  const extractText = deps.extractDocumentText ?? readDocumentText
  const checkDebug = deps.isDebugEnabled ?? isDebugChatToolsEnabled
  const debugToolProvider = createDebugChatToolProvider()
  const fileToolProvider = createFileToolProvider({
    listRoots: (id) => deps.invoke('list_ai_file_roots', { profileId: id }),
    run: (id, request) =>
      deps.invoke('run_ai_file_tool', { profileId: id, request }),
    preview: (id, request) =>
      deps.invoke('preview_ai_file_change', { profileId: id, request }),
    readDocumentText: async (id, path, mediaType) =>
      extractText(
        new Uint8Array(
          await deps.invoke('read_ai_file_bytes', { profileId: id, path })
        ),
        path,
        mediaType
      ),
    warn: deps.warn,
  })
  const memoryToolProvider = createMemoryToolProvider({
    readMemory: (id, file) =>
      deps.invoke('read_ai_profile_memory', { profileId: id, file }),
    searchMemory: (id, query) =>
      deps.invoke('search_ai_profile_memory', { profileId: id, query }),
    addFact: (id, file, fact, chatId) =>
      deps.invoke('add_ai_profile_memory_fact', {
        profileId: id,
        chatId,
        file,
        fact,
      }),
    replaceMemory: (id, file, oldText, newText, chatId) =>
      deps.invoke('replace_ai_profile_memory', {
        profileId: id,
        chatId,
        file,
        oldText,
        newText,
      }),
    rewriteMemory: (id, file, content, chatId) =>
      deps.invoke('rewrite_ai_profile_memory', {
        profileId: id,
        chatId,
        file,
        content,
      }),
    getMemoryMode: () => deps.getMemoryMode?.(),
    getChatId: deps.getChatId,
    warn: deps.warn,
  })

  const session = createChatToolsSession({
    providers: () => [
      fileToolProvider,
      memoryToolProvider,
      ...(checkDebug() ? [debugToolProvider] : []),
    ],
    isDebugEnabled: () => checkDebug(),
    warn: deps.warn,
  })

  /** The tools of a turn on the model picked in the chat */
  const turnTools = async (
    modelId: string,
    outputBudgetCharacters: number | undefined,
    profileTools?: ProfileToolSettings,
    memoryMode?: ProfileMemoryMode
  ) => {
    const canUseTools = deps.canUseTools()
    const resolvedMode = memoryMode ?? deps.getMemoryMode?.()
    return {
      canUseTools,
      tools: await session.toolsFor({
        profileId: deps.profileId,
        modelId,
        canUseTools,
        settings: profileTools,
        memoryMode: resolvedMode,
        outputBudgetCharacters,
      }),
    }
  }

  const mayOfferTools = (request: {
    canUseTools: boolean
    settings?: ProfileToolSettings
    memoryMode?: ProfileMemoryMode
  }) =>
    session.mayOfferTools({
      canUseTools: request.canUseTools,
      settings: request.settings,
      memoryMode: request.memoryMode ?? deps.getMemoryMode?.(),
    })

  return { ...session, turnTools, mayOfferTools }
}
