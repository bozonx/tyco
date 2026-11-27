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
  type ToolCallContext,
  type ToolCatalogSettings,
} from '@tyco/shared'

import { createReplyBlocksToolProvider } from '../reply-blocks/reply-blocks-tool'
import type { OperationLookup } from '../operations/operation-types'
import type { CommandEnvironment } from '../variables/command-variables'
import type { ChatToolPermissionsState } from './chat-tool-policy'
import type { ChatToolAlwaysAllowTarget } from './chat-tool-registry'
import {
  createChatToolsSession,
  type ChatToolResultRecord,
} from './chat-tools-session'
import { createCommandToolProvider } from './command-tools'
import {
  createDebugChatToolProvider,
  isDebugChatToolsEnabled,
} from './debug-chat-tools'
import { readDocumentText } from './file-document-text'
import { createFileToolProvider, type FileToolScope } from './file-tools'
import { createMemoryToolProvider } from './memory-tools'
import {
  createPluginChatToolProvider,
  type PluginChatToolsDependencies,
} from './plugin-chat-tools'
import type { SystemContext } from '../system-context/system-context'
import { createSystemToolProvider } from './system-tools'
import type { ToolScope } from './tool-catalog'
import { createWebToolProvider } from './web-tools'

interface FileToolArgs {
  context: ToolCallContext
  attachments: AiAttachedFile[]
}

const fileToolArgs = (scope: FileToolScope): FileToolArgs => ({
  context: scope.context,
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
    args: { profileId: string; chatId?: string | null; file: string }
  ): Promise<string>
  (
    command: 'peek_ai_profile_memory',
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
      section?: string | null
      description?: string | null
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
      context: ToolCallContext
      request: AiWebToolRequest
      runId?: string
    }
  ): Promise<AiWebToolOutput>
  (command: 'cancel_ai_web_tool', args: { runId: string }): Promise<boolean>
}

/** The IPC commands the chat tools call: none of them changes a setting */
export const CHAT_TOOL_COMMANDS = [
  'list_ai_file_roots',
  'run_ai_file_tool',
  'preview_ai_file_change',
  'read_ai_file_bytes',
  'run_ai_web_tool',
  'cancel_ai_web_tool',
  'read_ai_profile_memory',
  'peek_ai_profile_memory',
  'search_ai_profile_memory',
  'list_ai_profile_memory_topics',
  'add_ai_profile_memory_fact',
  'replace_ai_profile_memory',
  'rewrite_ai_profile_memory',
] as const

export interface DesktopWebToolsDependencies {
  invoke: DesktopChatToolsInvoke
  getFetchMaxCharacters?: () => number | undefined
  warn: (message: string) => void
}

/** The web tools as the desktop runs them, for the chats and AI commands */
export function createDesktopWebToolProvider(
  deps: DesktopWebToolsDependencies
) {
  return createWebToolProvider({
    run: (context, request, runId) =>
      deps.invoke('run_ai_web_tool', { context, request, runId }),
    cancel: (runId) => {
      deps.invoke('cancel_ai_web_tool', { runId }).catch((error: unknown) => {
        deps.warn(`Could not cancel the web tool call: ${String(error)}`)
      })
    },
    getMaxCharacters: deps.getFetchMaxCharacters,
    warn: deps.warn,
  })
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
  /** Model steps one answer may take, see `llm.maxToolSteps` */
  getMaxStepCount: () => number
  /** Whether the "Ask AI" chat has the web, used when `profileId` is null */
  isAskAiWebEnabled?: () => boolean | undefined
  /** The sources switched off everywhere */
  getProfileTools?: () => ProfileToolSettings | undefined
  getToolCatalog?: () => ToolCatalogSettings | undefined
  /** What the user wrote in the conversation, for the URLs it names */
  getHasPersonalData?: () => boolean
  getConversationText?: () => string | undefined
  /** Writes "always allow" into the chat's profile */
  alwaysAllow?: (targets: readonly ChatToolAlwaysAllowTarget[]) => Promise<void>
  /** The tool results the conversation already holds */
  getPreviousToolResults?: () => readonly ChatToolResultRecord[]
  /** The chat tools of the plugins */
  pluginTools?: PluginChatToolsDependencies
  /** Keeps the permissions "in this chat" with the chat */
  onPermissionsChange?: (state: ChatToolPermissionsState) => void
  warn: (message: string) => void
  extractDocumentText?: typeof readDocumentText
  isDebugEnabled?: () => boolean
  commands?: () => readonly CommandConfig[]
  operations?: OperationLookup
  environment?: () => CommandEnvironment
  /** `commandRunTimeoutSec`, the limit shared by all command runs */
  commandRunLimitSec?: () => number | undefined
  /** For `get_system_info`; the tool is not offered without it */
  systemContext?: Pick<SystemContext, 'details'>
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
    run: (scope, request, preview) =>
      deps.invoke('run_ai_file_tool', {
        ...fileToolArgs(scope),
        request,
        ...(preview ? { preview } : {}),
      }),
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
    readMemory: (id, file, chatId) =>
      deps.invoke('read_ai_profile_memory', { profileId: id, chatId, file }),
    peekMemory: (id, file) =>
      deps.invoke('peek_ai_profile_memory', { profileId: id, file }),
    searchMemory: (id, query) =>
      deps.invoke('search_ai_profile_memory', { profileId: id, query }),
    addFact: (id, file, fact, chatId, placement) =>
      deps.invoke('add_ai_profile_memory_fact', {
        profileId: id,
        chatId,
        file,
        fact,
        section: placement?.section ?? null,
        description: placement?.description ?? null,
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
  const webToolProvider = createDesktopWebToolProvider(deps)
  const systemToolProvider = deps.systemContext
    ? createSystemToolProvider(deps.systemContext)
    : undefined
  const commandToolProvider =
    deps.commands && deps.operations
      ? createCommandToolProvider({
          commands: deps.commands,
          operations: deps.operations,
          environment: deps.environment,
          warn: deps.warn,
          runLimitSec: deps.commandRunLimitSec,
        })
      : undefined

  const pluginToolProvider = deps.pluginTools
    ? createPluginChatToolProvider(deps.pluginTools)
    : undefined

  const session = createChatToolsSession({
    providers: () => [
      replyBlocksToolProvider,
      fileToolProvider,
      memoryToolProvider,
      webToolProvider,
      ...(systemToolProvider ? [systemToolProvider] : []),
      ...(commandToolProvider ? [commandToolProvider] : []),
      ...(pluginToolProvider ? [pluginToolProvider] : []),
      ...(checkDebug() ? [debugToolProvider] : []),
    ],
    getMaxStepCount: deps.getMaxStepCount,
    alwaysAllow: deps.alwaysAllow,
    onPermissionsChange: deps.onPermissionsChange,
    warn: deps.warn,
  })

  /** Where the chat's tools are offered: "Ask AI" or the profile */
  const toolScope = (
    profileTools: ProfileToolSettings | undefined
  ): ToolScope =>
    deps.profileId === null
      ? { kind: 'askAi', isWebEnabled: deps.isAskAiWebEnabled?.() !== false }
      : {
          kind: 'profile',
          profileId: deps.profileId,
          settings: profileTools,
          catalog: deps.getToolCatalog?.(),
        }

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
        scope: toolScope(profileTools),
        getCurrentScope: () =>
          toolScope(
            deps.getProfileTools ? deps.getProfileTools() : profileTools
          ),
        memoryMode: resolvedMode,
        outputBudgetCharacters,
        attachedFiles: deps.getAttachedFiles?.(),
        conversationText: deps.getConversationText?.(),
        hasPersonalData: deps.getHasPersonalData?.(),
        previousToolResults: deps.getPreviousToolResults?.(),
      }),
    }
  }

  const mayOfferTools = (request: { canUseTools: boolean }) =>
    session.mayOfferTools({ canUseTools: request.canUseTools })

  return { ...session, turnTools, mayOfferTools }
}
