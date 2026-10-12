import { describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

import { invokeDesktop } from './invoke'
import { DesktopIpcError } from './ipc-error'

describe('native invoke boundary', () => {
  it('forwards binary bodies and options without changing the argument list', async () => {
    native.invoke.mockResolvedValueOnce(7)
    const body = new Uint8Array([1, 2])
    const options = { headers: { 'x-tyco-socket-id': '1' } }
    expect(await invokeDesktop('binary', body, options)).toBe(7)
    expect(native.invoke).toHaveBeenLastCalledWith('binary', body, options)
    await invokeDesktop('example', { id: 1 })
    expect(native.invoke).toHaveBeenLastCalledWith('example', { id: 1 })
  })

  it('rejects with a coded Error and preserves specialized import failures', async () => {
    native.invoke.mockRejectedValueOnce({
      code: 'ioError',
      message: 'Permission denied',
    })
    await expect(invokeDesktop('save')).rejects.toBeInstanceOf(DesktopIpcError)
    const specialized = { kind: 'memory', message: 'Too many images' }
    native.invoke.mockRejectedValueOnce(specialized)
    await expect(invokeDesktop('image')).rejects.toBe(specialized)
  })
})
