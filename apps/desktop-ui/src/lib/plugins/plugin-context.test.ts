import { createToolRegistry } from '../tools/tool-registry'
import { createToolInvoker } from '../invocation/invoke-tool'
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
    getEditorInputSnapshot: vi.fn(() => ({
      value: 'text',
      selectedText: '',
      selectionStart: 0,
      selectionEnd: 0,
      revision: 0,
    })),
    applyEditorInputEdit: vi.fn(() => true),
    setEditorInputValue: vi.fn(),
    replaceEditorInputSelection: vi.fn(),
    setEditorInputFocus: vi.fn(),
    toEditor: vi.fn(),
    toastKey: vi.fn(),
    toastText: vi.fn(),
    t: vi.fn((key) => key),
    log: vi.fn(),
    openInBrowserAndHide: vi.fn(async () => ({ success: true })),
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
    await expect(context.getEditorInputValue()).rejects.toThrow(
      'requires editor'
    )
    await expect(
      context.callApiFunction('saveNote', ['/notes', 'file', 'text'])
    ).rejects.toThrow('requires notes')
    expect(
      await context.callApiFunction('saveUserConfig' as never, [] as never)
    ).toMatchObject({ success: false })
    expect(deps.openInBrowserAndHide).not.toHaveBeenCalled()
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
      isOutputRequested: true,
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
    expect(deps.toastKey).toHaveBeenCalledWith(
      pluginMessageKey('Example', 'local.saved'),
      'success'
    )
    expect(deps.toastText).toHaveBeenCalledWith('Provider detail', 'error')
  })
})

it('rejects removed browser API names', async () => {
  const { context, deps } = setup(['browser'])
  await expect(
    context.callApiFunction('openInBrowserAndClose' as 'openInBrowserAndHide', [
      'https://example.com',
    ])
  ).resolves.toMatchObject({ success: false })
  expect(deps.openInBrowserAndHide).not.toHaveBeenCalled()
})

it('routes note writes through the identity-bound scoped service', async () => {
  const { context, deps } = setup(['notes'])
  deps.writeNote = vi.fn(async () => ({
    success: true,
    result: '/notes/file.md',
  }))
  await expect(
    context.callApiFunction('appendNote', ['/notes', 'file.md', 'text'])
  ).resolves.toMatchObject({ success: true })
  expect(deps.writeNote).toHaveBeenCalledWith(
    'Example',
    '/notes',
    'file.md',
    'text',
    true
  )
  expect(deps.openInBrowserAndHide).not.toHaveBeenCalled()
})

describe('conditional plugin editor boundary', () => {
  it('requires editor capability for snapshots and conditional writes', async () => {
    const { context, deps } = setup([])
    await expect(context.getEditorInputSnapshot()).rejects.toThrow(
      'requires editor'
    )
    await expect(
      context.applyEditorInputEdit(
        {
          value: '',
          selectedText: '',
          selectionStart: 0,
          selectionEnd: 0,
          revision: 0,
        },
        '',
        'document'
      )
    ).rejects.toThrow('requires editor')
    expect(deps.getEditorInputSnapshot).not.toHaveBeenCalled()
    expect(deps.applyEditorInputEdit).not.toHaveBeenCalled()
  })

  it('passes conditional writes to the host and returns conflicts', async () => {
    const { context, deps } = setup()
    const snapshot = await context.getEditorInputSnapshot()
    vi.mocked(deps.applyEditorInputEdit).mockReturnValue(false)
    expect(
      await context.applyEditorInputEdit(snapshot, 'new', 'document')
    ).toBe(false)
    expect(deps.applyEditorInputEdit).toHaveBeenCalledWith(
      snapshot,
      'new',
      'document'
    )
  })

  it('rejects malformed ranges and disposed conditional writes', async () => {
    const { context, deps, controller } = setup()
    const snapshot = await context.getEditorInputSnapshot()
    await expect(
      context.applyEditorInputEdit(
        { ...snapshot, selectionEnd: 99 },
        '',
        'selection'
      )
    ).rejects.toThrow('Invalid conditional editor edit')
    controller.abort()
    await expect(
      context.applyEditorInputEdit(snapshot, '', 'document')
    ).rejects.toThrow('disposed')
    expect(deps.applyEditorInputEdit).not.toHaveBeenCalled()
  })
})

it('routes declarative toolbar buttons and action items through host invocation', async () => {
  const { context, deps, controller } = setup()
  deps.invokeTool = vi.fn(async () => ({
    ok: true,
    messageKey: 'toast.commandFailed',
  }))
  deps.invokeActionTool = vi.fn(async () => {})
  context.registerToolbarItems([{ id: 'button', toolId: 'test' }])
  context.registerActionsItems([
    { id: 'action', labelKey: 'local.label', toolId: 'test' },
  ])
  const item = vi.mocked(deps.registerToolbarItems).mock.calls[0][0][0]
  await item.action()
  expect(deps.invokeTool).toHaveBeenCalledWith(
    'Example.test',
    deps.getEditorInputSnapshot(),
    controller.signal
  )
  expect(item.ownerPluginId).toBe('Example')
  const actionItem = vi.mocked(deps.registerActionsItems).mock.calls[0][0][0]
  await actionItem.action('selected text')
  expect(deps.invokeActionTool).toHaveBeenCalledWith(
    'Example.test',
    'selected text',
    controller.signal
  )
  expect(actionItem.ownerPluginId).toBe('Example')
})

it('releases IDs on disposal and rolls back failed registrations', () => {
  const { context, deps } = setup()
  const disposeHost = vi.fn()
  vi.mocked(deps.registerToolbarItems).mockReturnValue(disposeHost)
  const dispose = context.registerToolbarItems([
    { id: 'button', action: vi.fn() },
  ])
  dispose()
  dispose()
  expect(disposeHost).toHaveBeenCalledOnce()
  context.registerToolbarItems([{ id: 'button', action: vi.fn() }])
  vi.mocked(deps.registerToolbarItems).mockImplementationOnce(() => {
    throw new Error('failed')
  })
  expect(() =>
    context.registerToolbarItems([{ id: 'next', action: vi.fn() }])
  ).toThrow('failed')
  expect(() =>
    context.registerToolbarItems([{ id: 'next', action: vi.fn() }])
  ).not.toThrow()
})

it.each([
  { disabled: 'false' },
  { label: {} },
  { position: 'middle' },
  { order: NaN },
])('rejects malformed UI metadata: %j', (metadata) => {
  const { context, deps } = setup()
  expect(() =>
    context.registerToolbarItems([
      { id: 'button', action: vi.fn(), ...metadata } as never,
    ])
  ).toThrow()
  expect(deps.registerToolbarItems).not.toHaveBeenCalled()
})

it('rejects malformed callback results before they reach consumers', async () => {
  const { context, deps } = setup()
  context.registerTools([
    tool(async () => ({ ok: true, content: {} }) as never),
  ])
  const registered = vi.mocked(deps.registerTools).mock.calls[0][0][0]
  await expect(
    registered.run({
      input: {},
      config: {},
      source: 'toolbar',
      signal: new AbortController().signal,
      isOutputRequested: false,
    })
  ).rejects.toThrow('Invalid tool result content')
})

it('shares structured input preparation between toolbar tools and commands', async () => {
  const { context, deps } = setup()
  const registry = createToolRegistry()
  deps.registerTools = (tools, config) =>
    registry.registerPluginTools('Example', tools, config)
  const invoke = createToolInvoker({ tools: registry })
  deps.invokeTool = (toolId, snapshot, signal) =>
    invoke(
      { toolId, toolConfig: {}, label: toolId, outputAction: 'none' },
      snapshot.value,
      { source: 'toolbar', output: 'none', editorSnapshot: snapshot, signal }
    )
  const run = vi.fn<ToolDefinition['run']>(async () => ({ ok: true }))
  context.registerTools([
    {
      id: 'structured',
      description: 'structured',
      inputSchema: {
        type: 'object',
        properties: { count: { type: 'integer' } },
        required: ['count'],
      },
      parseText: async () => ({ ok: true, input: { count: 3 } }),
      run,
    },
  ])
  context.registerToolbarItems([{ id: 'button', toolId: 'structured' }])
  const item = vi.mocked(deps.registerToolbarItems).mock.calls[0][0][0]
  const pending = item.action()
  expect(item.disabled).toBe(true)
  await pending
  expect(item.disabled).toBe(false)
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      input: { count: 3 },
      editorSnapshot: deps.getEditorInputSnapshot(),
      source: 'toolbar',
      isOutputRequested: false,
    })
  )
  await invoke(
    { toolId: 'Example.structured', toolConfig: {}, label: 'Command' },
    'text'
  )
  expect(run.mock.calls[0][0].input).toEqual(run.mock.calls[1][0].input)
})

describe('plugin context registrations', () => {
  const call = (signal = new AbortController().signal) => ({
    input: {},
    config: {},
    source: 'toolbar' as const,
    signal,
    isOutputRequested: false,
  })

  it('limits the number of contributions', () => {
    const { context } = setup()
    expect(() => context.registerActionsItems('items' as never)).toThrow(
      'Too many plugin contributions'
    )
    const many = Array.from({ length: 257 }, (_, index) => ({
      id: `item${index}`,
      action: vi.fn(),
    }))
    expect(() => context.registerToolbarItems(many)).toThrow(
      'Too many plugin contributions'
    )
    expect(() => context.registerTools(many as never)).toThrow(
      'Too many plugin contributions'
    )
  })

  it('tracks running actions and reports their failures with scoped keys', async () => {
    const { context, deps } = setup()
    let finish!: () => void
    context.registerActionsItems([
      {
        id: 'slow',
        action: () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      },
      {
        id: 'broken',
        action: () => {
          throw new PluginError('local.failed')
        },
      },
    ])
    const [slow, broken] = vi.mocked(deps.registerActionsItems).mock
      .calls[0]![0]
    const running = slow!.action('text')
    expect(slow!.isRunning).toBe(true)
    expect(slow!.disabled).toBe(true)
    finish()
    await running
    expect(slow!.disabled).toBe(false)
    await broken!.action('text')
    expect(deps.toastKey).toHaveBeenCalledWith(
      pluginMessageKey('Example', 'local.failed'),
      'error'
    )
    expect(deps.log).toHaveBeenCalledWith(
      'error',
      'Plugin action failed',
      expect.any(PluginError)
    )
  })

  it('rejects non-text edit results and passes ordinary errors through', async () => {
    const { context, deps } = setup()
    context.registerEditItems([
      { id: 'number', action: async () => 1 as never },
    ])
    context.registerCaseItems([
      {
        id: 'broken',
        action: () => {
          throw new Error('Plain')
        },
      },
    ])
    const numeric = vi.mocked(deps.registerEditItems).mock.calls[0]![0][0]!
    const broken = vi.mocked(deps.registerCaseItems).mock.calls[0]![0][0]!
    await expect(numeric.action('text')).rejects.toThrow(
      'Invalid text transform result'
    )
    await expect(broken.action('text')).rejects.toThrow('Plain')
  })

  it('scopes tool metadata and reports unavailability after disposal', () => {
    const { context, deps, controller } = setup()
    context.registerTools([
      {
        ...tool(async () => ({ ok: true })),
        labelKey: 'local.label',
        descriptionKey: 'local.description',
        defaultPhrasesKey: 'local.phrases',
      },
    ])
    const registered = vi.mocked(deps.registerTools).mock.calls[0]![0][0]!
    expect(registered).toMatchObject({
      labelKey: pluginMessageKey('Example', 'local.label'),
      descriptionKey: pluginMessageKey('Example', 'local.description'),
      defaultPhrasesKey: pluginMessageKey('Example', 'local.phrases'),
    })
    expect(registered.getUnavailableReasonKey?.()).toBe(undefined)
    controller.abort()
    expect(registered.getUnavailableReasonKey?.()).toBe(
      'toast.commandUnavailable'
    )
  })

  it('validates and scopes parser results', async () => {
    const { context, deps } = setup()
    const parseText = vi.fn()
    context.registerTools([{ ...tool(async () => ({ ok: true })), parseText }])
    const registered = vi.mocked(deps.registerTools).mock.calls[0]![0][0]!
    const parseContext = { signal: new AbortController().signal } as never

    parseText.mockResolvedValueOnce({ ok: true, input: { text: 'a' } })
    await expect(registered.parseText!('a', parseContext)).resolves.toEqual({
      ok: true,
      input: { text: 'a' },
    })
    parseText.mockResolvedValueOnce({ ok: false, messageKey: 'local.bad' })
    await expect(registered.parseText!('a', parseContext)).resolves.toEqual({
      ok: false,
      messageKey: pluginMessageKey('Example', 'local.bad'),
    })
    parseText.mockResolvedValueOnce({ ok: true })
    await expect(registered.parseText!('a', parseContext)).rejects.toThrow(
      'Invalid plugin parsed input'
    )
    parseText.mockRejectedValueOnce(new PluginError('local.parse'))
    await expect(
      registered.parseText!('a', parseContext)
    ).rejects.toMatchObject({
      messageKey: pluginMessageKey('Example', 'local.parse'),
    })
  })

  it('maps tool failures to results', async () => {
    const { context, deps } = setup()
    const run = vi.fn<ToolDefinition['run']>()
    context.registerTools([tool(run)])
    const registered = vi.mocked(deps.registerTools).mock.calls[0]![0][0]!

    run.mockResolvedValueOnce({ ok: false, messageKey: 'local.denied' })
    await expect(registered.run(call())).resolves.toEqual({
      ok: false,
      messageKey: pluginMessageKey('Example', 'local.denied'),
    })
    run.mockRejectedValueOnce(new PluginError('local.failed'))
    await expect(registered.run(call())).resolves.toEqual({
      ok: false,
      messageKey: pluginMessageKey('Example', 'local.failed'),
    })
    run.mockRejectedValueOnce(new Error('Crash'))
    await expect(registered.run(call())).rejects.toThrow('Crash')
    const controller = new AbortController()
    run.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('Aborted')
    })
    await expect(registered.run(call(controller.signal))).resolves.toEqual({
      ok: false,
      cancelled: true,
    })
  })

  it.each([
    [{ run: 'run' }, 'Invalid plugin tool'],
    [{ description: undefined }, 'Invalid plugin tool'],
    [{ inputSchema: null }, 'Invalid plugin tool'],
    [{ parseText: 'parse' }, 'Invalid plugin parser'],
  ])('rejects malformed tool definitions: %j', (patch, message) => {
    const { context, deps } = setup()
    expect(() =>
      context.registerTools([
        { ...tool(async () => ({ ok: true })), ...patch } as never,
      ])
    ).toThrow(message)
    expect(deps.registerTools).not.toHaveBeenCalled()
  })

  it('keeps tools from granting themselves notes access', () => {
    const { context } = setup(['notes'])
    const withField = (field: Record<string, unknown>) =>
      context.registerTools([
        {
          ...tool(async () => ({ ok: true })),
          id: `tool${Math.random().toString(36).slice(2)}`,
          configFields: [
            { name: 'pathToNotes', type: 'text', defaultValue: '', ...field },
          ],
        } as never,
      ])
    expect(() => withField({})).not.toThrow()
    expect(() => withField({ defaultValue: '/home' })).toThrow(
      'cannot grant notes access'
    )
    expect(() => withField({ value: '/home' })).toThrow(
      'cannot grant notes access'
    )
  })

  it('releases IDs after asynchronous and failing host disposers', async () => {
    const { context, deps } = setup()
    vi.mocked(deps.registerToolbarItems)
      .mockReturnValueOnce(async () => {})
      .mockReturnValueOnce(() => {
        throw new Error('Stuck')
      })
    const disposeAsync = context.registerToolbarItems([
      { id: 'first', action: vi.fn() },
    ])
    await disposeAsync()
    const disposeFailing = context.registerToolbarItems([
      { id: 'second', action: vi.fn() },
    ])
    expect(() => disposeFailing()).toThrow('Stuck')
    expect(() =>
      context.registerToolbarItems([
        { id: 'first', action: vi.fn() },
        { id: 'second', action: vi.fn() },
      ])
    ).not.toThrow()
  })
})

describe('plugin toolbar tools', () => {
  it('shows tool results as notifications', async () => {
    const { context, deps } = setup()
    deps.invokeTool = vi.fn(async () => ({
      ok: false,
      messageKey: 'toast.commandFailed',
      message: 'Details',
    }))
    context.registerToolbarItems([{ id: 'button', toolId: 'test' }])
    const item = vi.mocked(deps.registerToolbarItems).mock.calls[0]![0][0]!
    await item.action()
    expect(deps.toastKey).toHaveBeenCalledWith('toast.commandFailed', 'error')
    expect(deps.toastText).toHaveBeenCalledWith('Details', 'error')
  })

  it('stays silent for cancelled tools', async () => {
    const { context, deps } = setup()
    deps.invokeTool = vi.fn(async () => ({ ok: false, cancelled: true }))
    context.registerToolbarItems([{ id: 'button', toolId: 'test' }])
    const item = vi.mocked(deps.registerToolbarItems).mock.calls[0]![0][0]!
    await item.action()
    expect(deps.toastKey).not.toHaveBeenCalled()
  })

  it('reports a missing invoker without scoping host keys', async () => {
    const { context, deps } = setup()
    context.registerToolbarItems([{ id: 'button', toolId: 'test' }])
    const item = vi.mocked(deps.registerToolbarItems).mock.calls[0]![0][0]!
    await item.action()
    expect(deps.toastKey).toHaveBeenCalledWith('toast.commandFailed', 'error')
  })
})

describe('plugin desktop functions', () => {
  it('opens links for plugins with the browser capability', async () => {
    const { context, deps } = setup(['browser'])
    await expect(
      context.callApiFunction('openInBrowserAndHide', ['https://example.com'])
    ).resolves.toEqual({ success: true })
    expect(deps.openInBrowserAndHide).toHaveBeenCalledWith(
      'https://example.com'
    )
  })

  it.each([
    ['openInBrowserAndHide', ['a', 'b']],
    ['openInBrowserAndHide', [1]],
    ['saveNote', ['dir', 'file']],
    ['appendNote', 'dir'],
  ])('rejects malformed arguments for %s', async (name, args) => {
    const { context } = setup(['browser', 'notes'])
    await expect(
      context.callApiFunction(name as never, args as never)
    ).rejects.toThrow('Invalid desktop function arguments')
  })

  it('fails note writes without a scoped notes service', async () => {
    const { context } = setup(['notes'])
    await expect(
      context.callApiFunction('appendNote', ['dir', 'file', 'text'])
    ).rejects.toThrow('Scoped notes service is unavailable')
  })

  it('exposes editor reads, translations and config copies', async () => {
    const { context, deps } = setup()
    await expect(context.getEditorInputSelectedText()).resolves.toBe(
      'selection'
    )
    expect(context.t('local.label')).toBe(
      pluginMessageKey('Example', 'local.label')
    )
    context.toast('local.saved', 'success')
    expect(deps.toastKey).toHaveBeenCalledWith(
      pluginMessageKey('Example', 'local.saved'),
      'success'
    )
    const config = context.getMyConfig()
    expect(config).toEqual({ nested: { value: 1 } })
  })
})
