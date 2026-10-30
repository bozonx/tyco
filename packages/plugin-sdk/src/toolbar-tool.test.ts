import { describe, expect, it, vi } from 'vitest'

import { PluginError, TEXT_INPUT_SCHEMA } from './index.js'
import { createPluginTestContext } from './testing.js'
import { runToolFromAction, runToolFromToolbar } from './toolbar-tool.js'

describe('toolbar and action tools', () => {
  it('runs a declarative action item with the provided text', async () => {
    const { ctx } = createPluginTestContext({ value: 'editor' })
    const run = vi.fn(async () => ({ ok: true }))
    await runToolFromAction(
      ctx,
      { id: 'tool', description: 'tool', inputSchema: TEXT_INPUT_SCHEMA, run },
      'menu text'
    )
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ input: { text: 'menu text' }, source: 'menu' })
    )
  })
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

it('parses structured toolbar input using the shared input resolver', async () => {
  const { ctx } = createPluginTestContext({ value: 'three' })
  const run = vi.fn(async () => ({ ok: true }))
  await runToolFromToolbar(ctx, {
    id: 'structured',
    description: 'structured',
    inputSchema: {
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: ['count'],
    },
    parseText: async () => ({ ok: true, input: { count: 3 } }),
    run,
  })
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ input: { count: 3 }, source: 'toolbar' })
  )
})

it('rejects malformed parsed toolbar input and preserves portable errors', async () => {
  const { ctx, mocks } = createPluginTestContext({ value: 'text' })
  const run = vi.fn(async () => ({ ok: true }))
  await runToolFromToolbar(ctx, {
    id: 'structured',
    description: 'structured',
    inputSchema: {
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: ['count'],
    },
    parseText: async () => ({ ok: true, input: { count: 'wrong' } }),
    run,
  })
  expect(run).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith('toast.commandInputInvalid', 'error')
  await runToolFromToolbar(ctx, {
    id: 'failed',
    description: 'failed',
    inputSchema: TEXT_INPUT_SCHEMA,
    run: async () => {
      throw new PluginError('local.failure')
    },
  })
  expect(mocks.toast).toHaveBeenCalledWith('local.failure', 'error')
})
