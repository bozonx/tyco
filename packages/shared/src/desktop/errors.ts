import type { DesktopErrorCode } from '../generated/desktop-types'

/**
 * The outcome of a desktop command for callers that handle a failure themselves
 * rather than catch it
 */
export type IpcResult<T = unknown> =
  | ({ success: true; error?: never; errorCode?: never } & ([T] extends [void]
      ? { result?: T }
      : { result: T }))
  | {
      success: false
      error: string
      errorCode?: DesktopErrorCode
      result?: never
    }
