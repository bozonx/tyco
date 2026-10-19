import { describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

import { BINARY_META_HEADER, invokeDesktop } from './invoke'
import { DesktopIpcError } from './ipc-error'

describe('native invoke boundary', () => {
  it('sends binary bytes as the body and their metadata as a header', async () => {
    native.invoke.mockResolvedValueOnce(undefined)
    const bytes = new Uint8Array([1, 2])
    await invokeDesktop('save_ai_upload', {
      bytes,
      meta: { profileId: 'p', name: 'отчёт.pdf' },
    })
    expect(native.invoke).toHaveBeenLastCalledWith('save_ai_upload', bytes, {
      headers: {
        [BINARY_META_HEADER]: encodeURIComponent(
          '{"profileId":"p","name":"отчёт.pdf"}'
        ),
      },
    })
    await invokeDesktop('cancel_net_task', { id: 1 })
    expect(native.invoke).toHaveBeenLastCalledWith('cancel_net_task', { id: 1 })
  })

  it('rejects with a coded Error', async () => {
    native.invoke.mockRejectedValueOnce({
      code: 'ioError',
      message: 'Permission denied',
    })
    const failure = invokeDesktop('clear_chats', {})
    await expect(failure).rejects.toBeInstanceOf(DesktopIpcError)
    await expect(failure).rejects.toMatchObject({ code: 'ioError' })
  })
})
