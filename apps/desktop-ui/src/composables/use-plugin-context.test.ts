import { TEXT_INPUT_SCHEMA, type ToolDefinition } from '@tyco/plugin-sdk'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clientLogger } from '../lib/logger'
import { useEditorInputStore } from '../stores/editor-input'
import { useIpcStore } from '../stores/ipc'
import { useToolbarStore } from '../stores/toolbar'
import usePluginContext from './use-plugin-context'

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  disposePinia(pinia)
})

function createContext() {
  const controller = new AbortController()
  const context = usePluginContext().createContext('Example', () => ({}), {
    signal: controller.signal,
    capabilities: ['editor', 'notes', 'browser'],
    onDispose: vi.fn(),
    iconPrefix: 'mdi',
  })
  return { context, controller }
}

describe('plugin context wiring', () => {
  it('reads and edits the shared editor', async () => {
    const { context } = createContext()
    const editor = useEditorInputStore()
    editor.setValue('Hello world')
    editor.setSelection('world', 6, 11)
    await expect(context.getEditorInputValue()).resolves.toBe('Hello world')
    await expect(context.getEditorInputSelectedText()).resolves.toBe('world')

    context.replaceEditorInputSelection('there')
    expect(editor.value).toBe('Hello there')
    const snapshot = await context.getEditorInputSnapshot()
    await expect(
      context.applyEditorInputEdit(snapshot, 'Replaced', 'document')
    ).resolves.toBe(true)
    expect(editor.value).toBe('Replaced')
    context.setEditorInputValue('New')
    expect(editor.value).toBe('New')
    await expect(context.getEditorInputSelectedText()).resolves.toBe('')
  })

  it('runs toolbar buttons through the tool registry with the selection', async () => {
    const { context } = createContext()
    const run = vi.fn<ToolDefinition['run']>(async () => ({ ok: true }))
    context.registerTools([
      {
        id: 'upper',
        description: 'upper',
        inputSchema: TEXT_INPUT_SCHEMA,
        run,
      },
    ])
    context.registerToolbarItems([{ id: 'button', toolId: 'upper' }])
    const editor = useEditorInputStore()
    editor.setValue('Hello world')
    editor.setSelection('world', 6, 11)
    const button = useToolbarStore()
      .getToolbarItems()
      .find((item) => item.id === 'Example:button')!
    await button.action()
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ input: { text: 'world' } })
    )
  })

  it('routes desktop functions and logs through host services', async () => {
    const { context } = createContext()
    const call = vi
      .spyOn(useIpcStore(), 'call')
      .mockResolvedValue({ success: true } as never)
    await context.callApiFunction('appendNote', ['dir', 'note.md', 'text'])
    await context.callApiFunction('openInBrowserAndHide', [
      'https://example.com',
    ])
    expect(call.mock.calls).toEqual([
      [
        'write_plugin_note',
        {
          pluginId: 'Example',
          dir: 'dir',
          fileName: 'note.md',
          text: 'text',
          append: true,
        },
      ],
      ['open_in_browser_and_hide', { url: 'https://example.com' }],
    ])

    const log = vi.spyOn(clientLogger, 'log').mockImplementation(() => {})
    const error = vi.spyOn(clientLogger, 'error').mockImplementation(() => {})
    context.log('info', 'Started')
    const failure = new Error('Broken')
    context.log('error', 'Failed', failure)
    expect(log).toHaveBeenCalledWith('info', 'Started', 'Example')
    expect(error).toHaveBeenCalledWith('Failed', failure, 'Example')
  })
})
