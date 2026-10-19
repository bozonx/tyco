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

  it('keeps the code of a rejected file', () => {
    expect(
      normalizeDesktopError({ code: 'fileTooLarge', message: 'Too large' })
    ).toMatchObject({ code: 'fileTooLarge' })
  })

  it('keeps the message Tauri rejects with itself', () => {
    expect(
      normalizeDesktopError('invalid args `id` for command `get_chat`')
    ).toMatchObject({
      code: 'runtimeError',
      message: 'invalid args `id` for command `get_chat`',
    })
  })

  it('rejects unstructured error payloads', () => {
    expect(normalizeDesktopError({ failed: true })).toMatchObject({
      code: 'invalidData',
      message: 'Invalid desktop error payload',
    })
  })
})
