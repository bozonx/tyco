import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPluginTestContext } from '@tyco/plugin-sdk/testing'
import pluginIndex from './index.js'

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

  it('registers the note tool with its default commands and a toolbar button', () => {
    const { mocks, toolbarItems, tools } = setup({})

    expect(mocks.registerActionsItems).not.toHaveBeenCalled()
    expect(tools.map((tool) => tool.id)).toEqual(['write'])
    expect(tools[0].configFields?.map((field) => field.name)).not.toContain(
      'clearInputAfterSave'
    )
    const defaults = tools[0].defaultCommands
    expect(defaults?.map((preset) => [preset.id, preset.menu])).toEqual([
      ['note', { preferredKey: 'c' }],
      ['daily', { preferredKey: 'd' }],
    ])
    expect(toolbarItems).toHaveLength(1)
    expect(toolbarItems[0]).toMatchObject({
      id: 'fastNote',
      position: 'right',
      tooltipKey: 'local.label',
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
    expect(mocks.toast).toHaveBeenCalledWith('local.noteSaved', 'success')
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
    expect(mocks.toast).toHaveBeenCalledWith('local.noteSaved', 'success')
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
    expect(mocks.toast).toHaveBeenCalledWith('local.noteAppended', 'success')
  })

  it('appends to the daily note with the settings of its default command', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0))

    const { mocks, tools } = setup({ config: { pathToNotes: '/vault' } })
    const daily = tools[0].defaultCommands?.find(
      (preset) => preset.id === 'daily'
    )

    expect(daily).toBeDefined()

    const result = await tools[0].run({
      input: { text: 'Quick thought' },
      config: { pathToNotes: '/vault', ...daily?.toolConfig },
      source: 'launcher',
      signal: new AbortController().signal,
      wantsOutput: false,
    })

    expect(mocks.callApiFunction).toHaveBeenCalledWith('appendNote', [
      '/vault',
      '2026-10-03.md',
      '- **12:00**: Quick thought\n',
    ])
    expect(result).toEqual({
      ok: true,
      messageKey: 'local.noteAppended',
      keepWindow: false,
    })
  })

  it('reports a failed save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { mocks, toolbarItems } = setup({
      value: 'text',
      config: { pathToNotes: '/notes' },
      apiResult: { success: false, error: 'denied' },
    })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('local.noteSaveFailed', 'error')
  })

  it('warns when the notes folder is not configured', async () => {
    const { mocks, toolbarItems } = setup({ value: 'text' })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('local.noNotesPath', 'warn')
    expect(mocks.callApiFunction).not.toHaveBeenCalled()
  })

  it('reports missing text', async () => {
    const { mocks, toolbarItems } = setup({
      value: '',
      config: { pathToNotes: '/notes' },
    })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('toast.textNotSelected', 'warn')
    expect(mocks.callApiFunction).not.toHaveBeenCalled()
  })

  it('clears the editor only for a call from the editor', async () => {
    const { mocks, tools } = setup({
      value: ' menu text ',
      config: { pathToNotes: '/notes', clearInputAfterSave: true },
    })
    const call = (source: 'menu' | 'launcher') =>
      tools[0].run({
        input: { text: ' menu text ' },
        config: { pathToNotes: '/notes' },
        source,
        signal: new AbortController().signal,
        wantsOutput: false,
      })

    expect(await call('launcher')).toMatchObject({ keepWindow: false })
    expect(mocks.setEditorInputValue).not.toHaveBeenCalled()
    expect(await call('menu')).toMatchObject({ keepWindow: true })
    expect(mocks.setEditorInputValue).toHaveBeenCalledWith('')
    expect(mocks.callApiFunction).toHaveBeenCalledWith('saveNote', [
      '/notes',
      expect.any(String),
      'menu text\n',
    ])
  })
})

describe('FastNote editor conflicts', () => {
  it('preserves text edited while saving a previous note', async () => {
    const { ctx, mocks, toolbarItems } = setup({
      value: 'original note',
      config: { pathToNotes: '/notes', clearInputAfterSave: true },
    })
    let finish!: () => void
    let started!: () => void
    const saving = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.callApiFunction.mockImplementation(() => {
      started()
      return new Promise((resolve) => {
        finish = () => resolve({ success: true })
      })
    })
    const pending = toolbarItems[0].action()
    await saving
    ctx.setEditorInputValue('new unsaved text')
    mocks.setEditorInputValue.mockClear()
    finish()
    await pending
    expect(await ctx.getEditorInputValue()).toBe('new unsaved text')
    expect(mocks.setEditorInputValue).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('local.noteSaved', 'success')
  })

  it('removes only a saved selection and preserves the rest of the editor', async () => {
    const { ctx, mocks, toolbarItems } = setup({
      value: 'selected surrounding text',
      selectedText: 'selected',
      config: { pathToNotes: '/notes', clearInputAfterSave: true },
    })
    await toolbarItems[0].action()
    expect(mocks.applyEditorInputEdit).toHaveBeenCalledWith(
      expect.objectContaining({ selectedText: 'selected' }),
      '',
      'selection'
    )
    expect(await ctx.getEditorInputValue()).toBe(' surrounding text')
    expect(mocks.setEditorInputValue).not.toHaveBeenCalled()
  })

  it('does not clear the editor when menu input belongs to another source', async () => {
    const { ctx, mocks, tools } = setup({
      value: 'new unsaved text',
      config: { pathToNotes: '/notes', clearInputAfterSave: true },
    })
    await tools[0].run({
      input: { text: 'earlier menu input' },
      config: { pathToNotes: '/notes' },
      source: 'menu',
      signal: new AbortController().signal,
      wantsOutput: false,
    })
    expect(await ctx.getEditorInputValue()).toBe('new unsaved text')
    expect(mocks.applyEditorInputEdit).not.toHaveBeenCalled()
  })

  it('does not clear the editor after a failed save', async () => {
    const { ctx, mocks, toolbarItems } = setup({
      value: 'original note',
      config: { pathToNotes: '/notes', clearInputAfterSave: true },
      apiResult: { success: false },
    })
    await toolbarItems[0].action()
    expect(await ctx.getEditorInputValue()).toBe('original note')
    expect(mocks.applyEditorInputEdit).not.toHaveBeenCalled()
  })
})
