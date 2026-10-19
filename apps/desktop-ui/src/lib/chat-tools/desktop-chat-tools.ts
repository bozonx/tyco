import {
  type AiFileChangePreview,
  type AiFileRoot,
  type AiFileToolOutput,
  type AiFileToolRequest,
  type ProfileToolSettings,
} from '@tyco/shared'

import { createChatToolsSession } from './chat-tools-session'
import {
  createDebugChatToolProvider,
  isDebugChatToolsEnabled,
} from './debug-chat-tools'
import { readDocumentText } from './file-document-text'
import { createFileToolProvider } from './file-tools'

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
}

export interface DesktopChatToolsDependencies {
  profileId: string | null
  invoke: DesktopChatToolsInvoke
  canUseTools: () => boolean
  warn: (message: string) => void
  extractDocumentText?: typeof readDocumentText
  isDebugEnabled?: () => boolean
}

/** Wires desktop file tools and debug tools into a per-chat tool session. */
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

  const session = createChatToolsSession({
    providers: () =>
      checkDebug() ? [fileToolProvider, debugToolProvider] : [fileToolProvider],
    isDebugEnabled: () => checkDebug(),
    warn: deps.warn,
  })

  /** The tools of a turn on the model picked in the chat */
  const turnTools = async (
    modelId: string,
    outputBudgetCharacters: number | undefined,
    profileTools?: ProfileToolSettings
  ) => {
    const canUseTools = deps.canUseTools()
    return {
      canUseTools,
      tools: await session.toolsFor({
        profileId: deps.profileId,
        modelId,
        canUseTools,
        settings: profileTools,
        outputBudgetCharacters,
      }),
    }
  }

  return { ...session, turnTools }
}
