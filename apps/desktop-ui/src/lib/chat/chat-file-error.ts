import { DesktopIpcError } from '../desktop/ipc-error'

export type ChatFileErrorKind =
  | 'unsupported'
  | 'size'
  | 'invalid'
  | 'empty'
  | 'textLimit'
  | 'imageLimit'
  | 'fileLimit'
  | 'pdfPages'
  | 'password'
  | 'memory'
  /** A known image format the system decoder cannot read */
  | 'imageFormat'

export class ChatFileError extends Error {
  constructor(readonly kind: ChatFileErrorKind) {
    super(`Chat file import failed: ${kind}`)
  }
}

/** Why a file failed, whether the webview or the Rust side rejected it */
export function chatFileErrorKind(error: unknown): ChatFileErrorKind {
  if (error instanceof ChatFileError) return error.kind
  if (error instanceof DesktopIpcError) {
    if (error.code === 'fileTooLarge') return 'size'
    // the session memory of chat images is full
    if (error.code === 'resourceLimit') return 'memory'
  }
  return 'invalid'
}

/** Accepted files the user should still know something about */
export type ChatFileNotice =
  | { kind: 'secrets' }
  | { kind: 'pdfPagesSkipped'; count: number }
  | { kind: 'animatedFirstFrame' }

export const CHAT_FILE_ERROR_KEYS: Record<ChatFileErrorKind, string> = {
  unsupported: 'chat.fileUnsupported',
  size: 'chat.fileSizeLimit',
  invalid: 'chat.fileInvalid',
  empty: 'chat.fileEmpty',
  textLimit: 'chat.fileTextLimit',
  imageLimit: 'chat.imageLimit',
  fileLimit: 'chat.fileCountLimit',
  pdfPages: 'chat.pdfPageLimit',
  password: 'chat.pdfPassword',
  memory: 'chat.imageMemoryLimit',
  imageFormat: 'chat.imageFormatUnavailable',
}

export function formatChatFileNotice(
  name: string,
  notice: ChatFileNotice,
  translate: (key: string, params?: Record<string, string | number>) => string
): string {
  const message =
    notice.kind === 'secrets'
      ? translate('chat.fileSecretsWarning')
      : notice.kind === 'animatedFirstFrame'
        ? translate('chat.animatedImageFirstFrame')
        : translate('chat.pdfPagesSkipped', { count: notice.count })
  return `${name}: ${message}`
}
