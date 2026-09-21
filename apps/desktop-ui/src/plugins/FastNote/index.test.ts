import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPluginTestContext } from '../plugin-test-context'
import pluginIndex, { buildNoteFileName } from './index'

const setup = (options: Parameters<typeof createPluginTestContext>[0]) => {
  const context = createPluginTestContext(options)
  pluginIndex().init(context.ctx)
  return context
}

describe('FastNote plugin', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('builds a sortable file name from the local time', () => {
    expect(buildNoteFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      '2026-01-02_03-04-05.md'
    )
  })

  it('registers a single button in the right part of the editor toolbar', () => {
    const { mocks, toolbarItems } = setup({})

    expect(mocks.registerActionsItems).not.toHaveBeenCalled()
    expect(toolbarItems).toHaveLength(1)
    expect(toolbarItems[0]).toMatchObject({
      id: 'fastNote',
      position: 'right',
      tooltipKey: 'plugin.fastNote.label',
    })
  })

  it('saves the selected text into the configured folder', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 21, 14, 30, 0))

    const { mocks, toolbarItems } = setup({
      value: 'whole text',
      selectedText: ' selected ',
      config: { pathToNotes: ' ~/notes ' },
    })

    await toolbarItems[0].action()

    expect(mocks.callApiFunction).toHaveBeenCalledWith('saveNote', [
      '~/notes',
      '2026-09-21_14-30-00.md',
      'selected\n',
    ])
    expect(mocks.toast).toHaveBeenCalledWith('toast.noteSaved', 'success')
  })

  it('reports a failed save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { mocks, toolbarItems } = setup({
      value: 'text',
      config: { pathToNotes: '/notes' },
      apiResult: { success: false, error: 'denied' },
    })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('toast.noteSaveFailed', 'error')
  })

  it('warns when the notes folder is not configured', async () => {
    const { mocks, toolbarItems } = setup({ value: 'text' })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('toast.noNotesPath', 'warn')
    expect(mocks.callApiFunction).not.toHaveBeenCalled()
  })

  it('reports missing text', async () => {
    const { mocks, toolbarItems } = setup({
      value: '',
      config: { pathToNotes: '/notes' },
    })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('toast.textNotSelected', 'error')
    expect(mocks.callApiFunction).not.toHaveBeenCalled()
  })
})
