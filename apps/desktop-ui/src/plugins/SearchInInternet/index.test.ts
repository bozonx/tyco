import { describe, expect, it } from 'vitest'

import { createPluginTestContext } from '../plugin-test-context'
import pluginIndex, { DEFAULT_SEARCH_URL } from './index'

const setup = (options: Parameters<typeof createPluginTestContext>[0]) => {
  const context = createPluginTestContext(options)
  pluginIndex().init(context.ctx)
  return context
}

describe('SearchInInternet plugin', () => {
  it('registers a single button in the right part of the editor toolbar', () => {
    const { mocks, toolbarItems } = setup({})

    expect(mocks.registerActionsItems).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'searchInInternet', preferredKey: 'v' }),
    ])
    expect(toolbarItems).toHaveLength(1)
    expect(toolbarItems[0]).toMatchObject({
      id: 'searchInInternet',
      position: 'right',
      tooltipKey: 'plugin.searchInInternet.label',
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

    expect(mocks.toast).toHaveBeenCalledWith('toast.noSearchBaseUrl', 'warn')
    expect(mocks.callApiFunction).not.toHaveBeenCalled()
  })

  it('reports a browser that could not be opened', async () => {
    const { mocks, toolbarItems } = setup({
      value: 'text',
      apiResult: { success: false, error: 'xdg-open failed' },
    })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith(
      'toast.openInBrowserFailed',
      'error'
    )
  })

  it('reports missing text', async () => {
    const { mocks, toolbarItems } = setup({ value: '   ' })

    await toolbarItems[0].action()

    expect(mocks.toast).toHaveBeenCalledWith('toast.textNotSelected', 'error')
    expect(mocks.callApiFunction).not.toHaveBeenCalled()
  })
})

it('uses the text supplied by the action menu', async () => {
  const { mocks } = setup({
    value: 'editor text',
    selectedText: 'selection',
    config: { pathToNotes: '/notes' },
  })
  await mocks.registerActionsItems.mock.calls[0][0][0].action(' menu text ')
  expect(mocks.callApiFunction).toHaveBeenCalledWith('openInBrowserAndClose', [
    DEFAULT_SEARCH_URL + 'menu%20text',
  ])
})
