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

  it('registers action menu items and a toolbar button', () => {
    const { mocks, toolbarItems } = setup({})

    expect(mocks.registerActionsItems).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'fastNote', preferredKey: 'c' }),
      expect.objectContaining({ id: 'fastNoteAppendDaily', preferredKey: 'd' }),
    ])
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

  it('saves note using folderPreset and cleans editor if clearInputAfterSave is set', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 3, 10, 0, 0))

    const { mocks, toolbarItems } = setup({
      value: '# Project Alpha\nDetails',
      config: {
        pathToNotes: '/vault',
        folderPreset: 'year_month',
        clearInputAfterSave: true,
      },
    })

    await toolbarItems[0].action()

    expect(mocks.callApiFunction).toHaveBeenCalledWith('saveNote', [
      '/vault/2026/10',
      '2026-10-03_10-00-00.md',
      '# Project Alpha\nDetails\n',
    ])
    expect(mocks.setEditorInputValue).toHaveBeenCalledWith('')
    expect(mocks.toast).toHaveBeenCalledWith('toast.noteSaved', 'success')
  })

  it('appends note when saveMode is append', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 3, 10, 15, 0))

    const { mocks, toolbarItems } = setup({
      value: 'Call client',
      config: { pathToNotes: '/vault', preset: 'obsidian_daily' },
    })

    await toolbarItems[0].action()

    expect(mocks.callApiFunction).toHaveBeenCalledWith('appendNote', [
      '/vault',
      '2026-10-03.md',
      '- **10:15**: Call client\n',
    ])
    expect(mocks.toast).toHaveBeenCalledWith('toast.noteAppended', 'success')
  })

  it('executes append daily note from the second action menu item', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0))

    const { mocks } = setup({
      value: 'Quick thought',
      config: { pathToNotes: '/vault' },
    })

    const actions = mocks.registerActionsItems.mock.calls[0][0]!
    const appendDailyAction = actions.find(
      (a) => a.id === 'fastNoteAppendDaily'
    )
    expect(appendDailyAction).toBeDefined()

    await appendDailyAction?.action('Quick thought')

    expect(mocks.callApiFunction).toHaveBeenCalledWith('appendNote', [
      '/vault',
      '2026-10-03.md',
      '- **12:00**: Quick thought\n',
    ])
    expect(mocks.toast).toHaveBeenCalledWith('toast.noteAppended', 'success')
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

  it('uses the text supplied by the action menu', async () => {
    const { mocks } = setup({
      value: 'editor text',
      selectedText: 'selection',
      config: { pathToNotes: '/notes' },
    })
    await mocks.registerActionsItems.mock.calls[0][0][0].action(' menu text ')
    expect(mocks.callApiFunction).toHaveBeenCalledWith('saveNote', [
      '/notes',
      expect.any(String),
      'menu text\n',
    ])
  })
})
