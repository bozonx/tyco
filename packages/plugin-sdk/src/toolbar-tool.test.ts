import { describe, expect, it, vi } from 'vitest'

import { TEXT_INPUT_SCHEMA } from './index.js'
import { createPluginTestContext } from './testing.js'
import { runToolFromToolbar } from './toolbar-tool.js'

describe('toolbar tools', () => {
  it('keeps translated notifications separate from plain text', async () => {
    const { ctx, mocks } = createPluginTestContext({ value: 'text' })
    await runToolFromToolbar(ctx, {
      id: 'tool',
      description: 'tool',
      inputSchema: TEXT_INPUT_SCHEMA,
      run: async () => ({ ok: true, message: 'Plain detail' }),
    })
    expect(mocks.toastText).toHaveBeenCalledWith('Plain detail', 'success')
    expect(mocks.toast).not.toHaveBeenCalled()
  })
  it('suppresses late notifications after disposal and reports failures', async () => {
    const { ctx, mocks } = createPluginTestContext({ value: 'text' })
    await runToolFromToolbar(ctx, {
      id: 'tool',
      description: 'tool',
      inputSchema: TEXT_INPUT_SCHEMA,
      run: vi.fn(async () => {
        throw new Error('failed')
      }),
    })
    expect(mocks.log).toHaveBeenCalledWith(
      'error',
      'Toolbar tool failed',
      expect.any(Error)
    )
    expect(mocks.toast).toHaveBeenCalledWith('toast.commandFailed', 'error')
  })
})
