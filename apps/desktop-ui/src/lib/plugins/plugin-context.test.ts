import {
  PluginError,
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
} from '@tyco/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  createPluginContext,
  type PluginContextDependencies,
} from './plugin-context'
import { pluginMessageKey } from './plugin-resources'

function setup(
  capabilities: Array<'editor' | 'notes' | 'browser'> = ['editor']
) {
  const controller = new AbortController()
  const deps: PluginContextDependencies = {
    registerActionsItems: vi.fn(),
    registerEditItems: vi.fn(),
    registerCaseItems: vi.fn(),
    registerFormatItems: vi.fn(),
    registerToolbarItems: vi.fn(),
    registerTools: vi.fn(),
    getEditorInputValue: vi.fn(() => 'text'),
    getEditorInputSelectedText: vi.fn(() => 'selection'),
    setEditorInputValue: vi.fn(),
    replaceEditorInputSelection: vi.fn(),
    setEditorInputFocus: vi.fn(),
    toEditor: vi.fn(),
    toast: vi.fn(),
    toastText: vi.fn(),
    t: vi.fn((key) => key),
    log: vi.fn(),
    callApiFunction: vi.fn(async () => ({ success: true })),
  }
  const context = createPluginContext(
    'Example',
    () => ({ nested: { value: 1 } }),
    {
      signal: controller.signal,
      capabilities,
      onDispose: vi.fn(),
      iconPrefix: 'mdi',
    },
    deps
  )
  return { context, deps, controller }
}
const tool = (run: ToolDefinition['run']): ToolDefinition => ({
  id: 'test',
  description: 'test',
  inputSchema: TEXT_INPUT_SCHEMA,
  run,
})
describe('plugin context boundary', () => {
  it('scopes IDs, translations and icons and rejects duplicate registrations', () => {
    const { context, deps } = setup()
    context.registerToolbarItems([
      {
        id: 'button',
        icon: 'mdi:web',
        tooltipKey: 'local.label',
        action: vi.fn(),
      },
    ])
    expect(deps.registerToolbarItems).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'Example:button',
        tooltipKey: pluginMessageKey('Example', 'local.label'),
        icon: expect.stringMatching(/^tyco-p[0-9a-f]+:web$/),
      }),
    ])
    expect(() =>
      context.registerToolbarItems([{ id: 'button', action: vi.fn() }])
    ).toThrow('Duplicate')
  })
  it('limits services by declared capabilities and rejects unknown IPC methods', async () => {
    const { context, deps } = setup([])
    await expect(context.getEditorInputValue()).rejects.toThrow('requires editor')
    await expect(
      context.callApiFunction('saveNote', ['/notes', 'file', 'text'])
    ).rejects.toThrow('requires notes')
    expect(
      await context.callApiFunction('saveUserConfig' as never, [] as never)
    ).toMatchObject({ success: false })
    expect(deps.callApiFunction).not.toHaveBeenCalled()
  })
  it('rejects stale contexts after deactivation', () => {
    const { context, controller, deps } = setup()
    controller.abort()
    expect(() => context.setEditorInputValue('changed')).toThrow('disposed')
    expect(() =>
      context.registerTools([tool(async () => ({ ok: true }))])
    ).toThrow('disposed')
    expect(deps.setEditorInputValue).not.toHaveBeenCalled()
  })
  it('translates portable errors without depending on plugin implementation classes', async () => {
    const { context, deps } = setup()
    context.registerFormatItems([
      {
        id: 'format',
        action: () => {
          throw new PluginError('local.invalid')
        },
      },
    ])
    const item = vi.mocked(deps.registerFormatItems).mock.calls[0][0][0]
    await expect(item.action('text')).rejects.toMatchObject({
      messageKey: pluginMessageKey('Example', 'local.invalid'),
    })
  })
  it('aborts tool work when its plugin is disabled and suppresses late output', async () => {
    const { context, deps, controller } = setup()
    let complete!: () => void
    let received!: AbortSignal
    context.registerTools([
      tool(async ({ signal }) => {
        received = signal
        await new Promise<void>((resolve) => {
          complete = resolve
        })
        return { ok: true, content: 'late' }
      }),
    ])
    const registered = vi.mocked(deps.registerTools).mock.calls[0][0][0]
    const running = registered.run({
      input: { text: 'text' },
      config: {},
      source: 'external',
      signal: new AbortController().signal,
      wantsOutput: true,
    })
    controller.abort()
    expect(received.aborted).toBe(true)
    complete()
    expect(await running).toEqual({ ok: false, cancelled: true })
  })
  it('does not apply an edit transformation that finishes after deactivation', async () => {
    const { context, deps, controller } = setup()
    let complete!: (text: string) => void
    context.registerFormatItems([
      {
        id: 'format',
        action: () =>
          new Promise<string>((resolve) => {
            complete = resolve
          }),
      },
    ])
    const item = vi.mocked(deps.registerFormatItems).mock.calls[0][0][0]
    const running = item.action('original')
    controller.abort()
    complete('late replacement')
    await expect(running).rejects.toMatchObject({
      code: 'tyco-plugin-cancelled',
    })
  })
  it('keeps plain notifications separate from translation keys', () => {
    const { context, deps } = setup()
    context.toast('local.saved', 'success')
    context.toastText('Provider detail', 'error')
    expect(deps.toast).toHaveBeenCalledWith(
      pluginMessageKey('Example', 'local.saved'),
      'success'
    )
    expect(deps.toastText).toHaveBeenCalledWith('Provider detail', 'error')
  })
})
