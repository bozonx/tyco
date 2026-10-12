import { describe, expect, it } from 'vitest'
import {
  DesktopIpcError,
  desktopErrorMessage,
  normalizeDesktopError,
} from './ipc-error'

describe('desktop IPC errors', () => {
  it('preserves the native code and readable message as an Error', () => {
    const payload = {
      code: 'configConflict',
      message: 'Changed in another window',
    }
    const error = normalizeDesktopError(payload)
    expect(error).toBeInstanceOf(DesktopIpcError)
    expect(error).toMatchObject({
      code: 'configConflict',
      message: payload.message,
      cause: payload,
    })
    expect(String(error)).toBe('Error: Changed in another window')
    expect(desktopErrorMessage(payload)).toBe(payload.message)
  })

  it('leaves legacy and file-import errors intact', () => {
    const fileError = { kind: 'memory', message: 'Too many images' }
    expect(normalizeDesktopError(fileError)).toBe(fileError)
    expect(normalizeDesktopError('failed')).toBe('failed')
  })
})
