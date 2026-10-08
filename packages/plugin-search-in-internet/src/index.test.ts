import { describe, expect, it } from 'vitest'

import { createPluginTestContext } from '@tyco/plugin-sdk/testing'
import pluginIndex, { DEFAULT_SEARCH_URL, MAX_SEARCH_LENGTH } from './index.js'

const setup = (options: Parameters<typeof createPluginTestContext>[0]) => {
  const context = createPluginTestContext(options)
  pluginIndex().init(context.ctx)
  return context
}

describe('SearchInInternet plugin', () => {
  it('registers the search tool and a button in the editor toolbar', () => {
    const { mocks, toolbarItems, tools } = setup({})

    expect(mocks.registerActionsItems).not.toHaveBeenCalled()
    expect(tools.map((tool) => tool.id)).toEqual(['search'])
    expect(tools[0].defaultCommands?.({ t: (key) => key })).toEqual([
      expect.objectContaining({
        id: 'search',
        menu: {
          replaces: 'SearchInInternet:searchInInternet',
          preferredKey: 'v',
        },
      }),
    ])
    expect(toolbarItems).toHaveLength(1)
    expect(toolbarItems[0]).toMatchObject({
      id: 'searchInInternet',
      position: 'right',
      tooltipKey: 'local.label',
    })
  })

  it('searches the selected text with the configured URL', async () => {
    const { mocks, toolbarItems } = setup({
      value: 'whole text',
      selectedText: ' a&b ',
      config: { url: 'https://example.com/?s=' },
    })

    await toolbarItems[0].action()

    expect(mocks.callApiFunction).toHaveBeenCalledWith(
      'openInBrowserAndClose',
      ['https://example.com/?s=a%26b']
    )
  })

  it('falls back to the whole text and the default URL', async () => {
    const { mocks, toolbarItems } = setup({ value: 'hello' })

    await toolbarItems[0].action()

    expect(mocks.callApiFunction).toHaveBeenCalledWith(
      'openInBrowserAndClose',
      [`${DEFAULT_SEARCH_URL}hello`]
    )
  })

  it('warns when the URL was cleared in the settings', async () => {
    const { mocks, toolbarItems } = setup({
      value: 'hello',
      config: { url: '  ' },
    })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('local.noSearchBaseUrl', 'warn')
    expect(mocks.callApiFunction).not.toHaveBeenCalled()
  })

  it('reports a browser that could not be opened', async () => {
    const { mocks, toolbarItems } = setup({
      value: 'text',
      apiResult: { success: false, error: 'xdg-open failed' },
    })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith(
      'local.openInBrowserFailed',
      'error'
    )
  })

  it('reports missing text', async () => {
    const { mocks, toolbarItems } = setup({ value: '   ' })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('toast.textNotSelected', 'warn')
    expect(mocks.callApiFunction).not.toHaveBeenCalled()
  })
})

it('searches the text of a command with the URL of the command', async () => {
  const { mocks, tools } = setup({ value: 'editor text' })
  const result = await tools[0].run({
    input: { text: ' menu text ' },
    config: { url: 'https://example.com/?q=' },
    source: 'launcher',
    signal: new AbortController().signal,
    wantsOutput: false,
  })
  expect(result).toEqual({ ok: true, keepWindow: true })
  expect(mocks.callApiFunction).toHaveBeenCalledWith('openInBrowserAndClose', [
    'https://example.com/?q=menu%20text',
  ])
  expect(mocks.toast).not.toHaveBeenCalled()
})

it('does not search a whole document sent by mistake', async () => {
  const { mocks, toolbarItems } = setup({
    value: 'a'.repeat(MAX_SEARCH_LENGTH + 1),
  })

  await toolbarItems[0].action()

  expect(mocks.callApiFunction).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith('local.textTooLongForSearch', 'warn')
})
