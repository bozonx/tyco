import type { DesktopErrorCode, DesktopErrorPayload } from '@tyco/shared'

const ERROR_CODES: ReadonlySet<string> = new Set([
  'operationFailed',
  'configConflict',
  'serviceUnavailable',
  'resourceLimit',
  'invalidInput',
  'unsupportedConfig',
  'runtimeError',
  'ioError',
  'invalidData',
])

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

/** Keep legacy string rejections and specialized file-import errors intact. */
export function normalizeDesktopError(error: unknown): unknown {
  return isDesktopError(error) && !(error instanceof DesktopIpcError)
    ? new DesktopIpcError(error.code, error.message, error)
    : error
}

export function desktopErrorMessage(error: unknown): string {
  return error instanceof Error || isDesktopError(error)
    ? error.message
    : String(error)
}
