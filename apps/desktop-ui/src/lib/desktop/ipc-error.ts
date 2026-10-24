import {
  DESKTOP_ERROR_CODES,
  type DesktopErrorCode,
  type DesktopErrorPayload,
} from '@tyco/shared'

const ERROR_CODES: ReadonlySet<string> = new Set(DESKTOP_ERROR_CODES)

/** The i18n key of the summary the user sees for each error code */
export const DESKTOP_ERROR_KEYS: Readonly<Record<DesktopErrorCode, string>> = {
  operationFailed: 'desktopErrors.operationFailed',
  configConflict: 'desktopErrors.configConflict',
  serviceUnavailable: 'desktopErrors.serviceUnavailable',
  busy: 'desktopErrors.busy',
  permissionDenied: 'desktopErrors.permissionDenied',
  resourceLimit: 'desktopErrors.resourceLimit',
  invalidInput: 'desktopErrors.invalidInput',
  notFound: 'desktopErrors.notFound',
  fileTooLarge: 'desktopErrors.fileTooLarge',
  unsupportedConfig: 'desktopErrors.unsupportedConfig',
  stale: 'desktopErrors.stale',
  runtimeError: 'desktopErrors.runtimeError',
  ioError: 'desktopErrors.ioError',
  invalidData: 'desktopErrors.invalidData',
}

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

/**
 * A command fails with `{ code, message }`; Tauri itself rejects with a plain
 * message, e.g. for arguments it cannot read or a command the window may not
 * call
 */
export function normalizeDesktopError(error: unknown): unknown {
  if (error instanceof Error) return error
  if (isDesktopError(error))
    return new DesktopIpcError(error.code, error.message, error)
  if (typeof error === 'string')
    return new DesktopIpcError('runtimeError', error, error)
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
