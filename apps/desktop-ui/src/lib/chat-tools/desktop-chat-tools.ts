import {
  type AiAttachedFile,
  type AiFileChangePreview,
  type AiFileRoot,
  type AiFileToolOutput,
  type AiFileToolRequest,
  type AiWebToolOutput,
  type AiWebToolRequest,
  type CommandConfig,
  type ProfileMemoryChange,
  type ProfileMemoryMode,
  type ProfileMemorySearchResult,
  type ProfileMemoryTopic,
  type ProfileToolSettings,
} from '@tyco/shared'

import { createReplyBlocksToolProvider } from '../reply-blocks/reply-blocks-tool'
import type { ToolLookup } from '../tools/tool-types'
import type { CommandEnvironment } from '../variables/command-variables'
import { createChatToolsSession } from './chat-tools-session'
import { createCommandToolProvider } from './command-tools'
import {
  createDebugChatToolProvider,
  isDebugChatToolsEnabled,
} from './debug-chat-tools'
import { readDocumentText } from './file-document-text'
import { createFileToolProvider, type FileToolScope } from './file-tools'
import { createMemoryToolProvider } from './memory-tools'
import { createWebToolProvider } from './web-tools'

interface FileToolArgs {
  profileId: string | null
  attachments: AiAttachedFile[]
}

const fileToolArgs = (scope: FileToolScope): FileToolArgs => ({
  profileId: scope.profileId,
  attachments: [...scope.attachments],
})

export interface DesktopChatToolsInvoke {
  (command: 'list_ai_file_roots', args: FileToolArgs): Promise<AiFileRoot[]>
  (
    command: 'run_ai_file_tool',
    args: FileToolArgs & { request: AiFileToolRequest }
  ): Promise<AiFileToolOutput>
  (
    command: 'preview_ai_file_change',
    args: FileToolArgs & { request: AiFileToolRequest }
  ): Promise<AiFileChangePreview>
  (
    command: 'read_ai_file_bytes',
    args: FileToolArgs & { path: string }
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
  (
    command: 'run_ai_web_tool',
    args: {
      profileId: string | null
      request: AiWebToolRequest
      runId?: string
    }
  ): Promise<AiWebToolOutput>
  (command: 'cancel_ai_web_tool', args: { runId: string }): Promise<boolean>
}

export interface DesktopChatToolsDependencies {
  profileId: string | null
  invoke: DesktopChatToolsInvoke
  canUseTools: () => boolean
  getMemoryMode?: () => ProfileMemoryMode | undefined
  getChatId?: () => string | null | undefined
  /** The originals attached to the conversation, for the file tools */
  getAttachedFiles?: () => readonly AiAttachedFile[]
  getFetchMaxCharacters?: () => number | undefined
  warn: (message: string) => void
  extractDocumentText?: typeof readDocumentText
  isDebugEnabled?: () => boolean
  commands?: () => readonly CommandConfig[]
  tools?: ToolLookup
  environment?: () => CommandEnvironment
}

/**
 * Wires desktop file tools, memory tools, and debug tools into a per-chat tool
 * session.
 */
export function createDesktopChatTools(deps: DesktopChatToolsDependencies) {
  const extractText = deps.extractDocumentText ?? readDocumentText
  const checkDebug = deps.isDebugEnabled ?? isDebugChatToolsEnabled
  const debugToolProvider = createDebugChatToolProvider()
  const replyBlocksToolProvider = createReplyBlocksToolProvider()
  const fileToolProvider = createFileToolProvider({
    listRoots: (scope) =>
      deps.invoke('list_ai_file_roots', fileToolArgs(scope)),
    run: (scope, request) =>
      deps.invoke('run_ai_file_tool', { ...fileToolArgs(scope), request }),
    preview: (scope, request) =>
      deps.invoke('preview_ai_file_change', {
        ...fileToolArgs(scope),
        request,
      }),
    readDocumentText: async (scope, path, mediaType) =>
      extractText(
        new Uint8Array(
          await deps.invoke('read_ai_file_bytes', {
            ...fileToolArgs(scope),
            path,
          })
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
  const webToolProvider = createWebToolProvider({
    run: (profileId, request, runId) =>
      deps.invoke('run_ai_web_tool', { profileId, request, runId }),
    cancel: (runId) => {
      deps.invoke('cancel_ai_web_tool', { runId }).catch((error: unknown) => {
        deps.warn(`Could not cancel the web tool call: ${String(error)}`)
      })
    },
    getMaxCharacters: deps.getFetchMaxCharacters,
    warn: deps.warn,
  })
  const commandToolProvider =
    deps.commands && deps.tools
      ? createCommandToolProvider({
          commands: deps.commands,
          tools: deps.tools,
          environment: deps.environment,
          warn: deps.warn,
        })
      : undefined

  const session = createChatToolsSession({
    providers: () => [
      replyBlocksToolProvider,
      fileToolProvider,
      memoryToolProvider,
      webToolProvider,
      ...(commandToolProvider ? [commandToolProvider] : []),
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
        attachedFiles: deps.getAttachedFiles?.(),
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
