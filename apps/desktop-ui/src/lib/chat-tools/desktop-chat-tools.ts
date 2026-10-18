import {
  DESKTOP_COMMANDS,
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
    command: typeof DESKTOP_COMMANDS.LIST_AI_FILE_ROOTS,
    args: { profileId: string }
  ): Promise<AiFileRoot[]>
  (
    command: typeof DESKTOP_COMMANDS.RUN_AI_FILE_TOOL,
    args: { profileId: string; request: AiFileToolRequest }
  ): Promise<AiFileToolOutput>
  (
    command: typeof DESKTOP_COMMANDS.PREVIEW_AI_FILE_CHANGE,
    args: { profileId: string; request: AiFileToolRequest }
  ): Promise<AiFileChangePreview>
  (
    command: typeof DESKTOP_COMMANDS.READ_AI_FILE_BYTES,
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
    listRoots: (id) =>
      deps.invoke(DESKTOP_COMMANDS.LIST_AI_FILE_ROOTS, { profileId: id }),
    run: (id, request) =>
      deps.invoke(DESKTOP_COMMANDS.RUN_AI_FILE_TOOL, {
        profileId: id,
        request,
      }),
    preview: (id, request) =>
      deps.invoke(DESKTOP_COMMANDS.PREVIEW_AI_FILE_CHANGE, {
        profileId: id,
        request,
      }),
    readDocumentText: async (id, path, mediaType) =>
      extractText(
        new Uint8Array(
          await deps.invoke(DESKTOP_COMMANDS.READ_AI_FILE_BYTES, {
            profileId: id,
            path,
          })
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
