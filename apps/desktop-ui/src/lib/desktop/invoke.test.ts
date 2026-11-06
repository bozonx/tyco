import { describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

import { BINARY_META_HEADER, invokeDesktop } from './invoke'
import { DesktopIpcError } from './ipc-error'

describe('native invoke boundary', () => {
  it('sends binary bytes as the body and their metadata as a header', async () => {
    native.invoke.mockResolvedValueOnce(undefined)
    const bytes = new Uint8Array([1, 2])
    await invokeDesktop('store_chat_image', {
      bytes,
      meta: { importId: 'i', name: 'отчёт.png' },
    })
    expect(native.invoke).toHaveBeenLastCalledWith('store_chat_image', bytes, {
      headers: {
        [BINARY_META_HEADER]: encodeURIComponent(
          '{"importId":"i","name":"отчёт.png"}'
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
