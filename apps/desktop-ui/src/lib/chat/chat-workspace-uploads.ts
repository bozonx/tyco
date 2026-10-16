import type { PreparedChatFile } from './chat-file-input'

type PrepareChatFile = (
  file: File,
  maxImageCount: number,
  isCurrent: () => boolean
) => Promise<PreparedChatFile>

export interface WorkspaceUploadsDependencies {
  /** Whether the chat's file tools could reach a kept file */
  shouldKeep: () => boolean
  /** Keeps the file; resolves with the path the model reaches it by */
  saveUpload: (file: File) => Promise<string>
  warn: (message: string) => void
}

/**
 * Keeps the files dropped into a profile chat in its `workspace/uploads/`, so
 * that the model can read them again, search and edit them with its file tools
 * rather than only see the text attached to one message. The attachment names
 * the path. A file that cannot be kept is still attached
 */
export function withWorkspaceUploads(
  prepare: PrepareChatFile,
  deps: WorkspaceUploadsDependencies
): PrepareChatFile {
  return async (file, maxImageCount, isCurrent) => {
    const prepared = await prepare(file, maxImageCount, isCurrent)
    // images have no text to search, and a replaced draft keeps nothing
    if (!prepared.attachments.length || !deps.shouldKeep() || !isCurrent())
      return prepared
    let workspacePath: string
    try {
      workspacePath = await deps.saveUpload(file)
    } catch (error) {
      deps.warn(
        `Could not keep ${file.name} in the workspace: ${String(error)}`
      )
      return prepared
    }
    return {
      ...prepared,
      attachments: prepared.attachments.map((attachment) => ({
        ...attachment,
        workspacePath,
      })),
    }
  }
}
