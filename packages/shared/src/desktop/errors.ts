export type DesktopErrorCode =
  | 'operationFailed'
  | 'configConflict'
  | 'serviceUnavailable'
  | 'resourceLimit'
  | 'invalidInput'
  | 'unsupportedConfig'
  | 'stale'
  | 'runtimeError'
  | 'ioError'
  | 'invalidData'

export interface DesktopErrorPayload {
  code: DesktopErrorCode
  message: string
}

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
