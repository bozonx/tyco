import {
  DESKTOP_ERROR_CODES,
  type DesktopErrorCode,
  type DesktopErrorPayload,
} from '@tyco/shared'

const ERROR_CODES: ReadonlySet<string> = new Set(DESKTOP_ERROR_CODES)

export function isDesktopError(error: unknown): error is DesktopErrorPayload {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ERROR_CODES.has(error.code) &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

export class DesktopIpcError extends Error {
  constructor(
    readonly code: DesktopErrorCode,
    message: string,
    cause: unknown
  ) {
    super(message, { cause })
  }
}

/** Every native command fails with `{ code, message }` */
export function normalizeDesktopError(error: unknown): unknown {
  if (error instanceof Error) return error
  if (isDesktopError(error))
    return new DesktopIpcError(error.code, error.message, error)
  return new DesktopIpcError(
    'invalidData',
    'Invalid desktop error payload',
    error
  )
}

export function desktopErrorMessage(error: unknown): string {
  return error instanceof Error || isDesktopError(error)
    ? error.message
    : String(error)
}
