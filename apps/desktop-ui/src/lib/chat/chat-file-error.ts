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

/** The kinds the Rust commands report as `{ kind, message }` */
const NATIVE_KINDS: ReadonlySet<string> = new Set(['size', 'memory', 'invalid'])

/** Why a file failed, whether the webview or the Rust side rejected it */
export function chatFileErrorKind(error: unknown): ChatFileErrorKind {
  if (error instanceof ChatFileError) return error.kind
  if (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    typeof error.kind === 'string' &&
    NATIVE_KINDS.has(error.kind)
  )
    return error.kind as ChatFileErrorKind
  return 'invalid'
}

/** Accepted files the user should still know something about */
export type ChatFileNotice =
  | { kind: 'secrets' }
  | { kind: 'pdfPagesSkipped'; count: number }
  | { kind: 'animatedFirstFrame' }
