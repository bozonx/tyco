import { describe, expect, it } from 'vitest'

import { createPluginTestContext } from '@tyco/plugin-sdk/testing'
import pluginIndex, {
  buildSearchUrl,
  DEFAULT_SEARCH_URL,
  MAX_SEARCH_LENGTH,
} from './index.js'

const setup = (options: Parameters<typeof createPluginTestContext>[0]) => {
  const context = createPluginTestContext(options)
  pluginIndex().init(context.ctx)
  return context
}

describe('SearchInInternet plugin', () => {
  it('registers the search tool, an action item and a button in the editor toolbar', () => {
    const { actionItems, toolbarItems, tools } = setup({})

    expect(tools.map((tool) => tool.id)).toEqual(['search'])
    expect(actionItems).toHaveLength(1)
    expect(actionItems[0]).toMatchObject({
      id: 'search',
      icon: 'mdi:web',
      labelKey: 'local.label',
    })
    expect(toolbarItems).toHaveLength(1)
    expect(toolbarItems[0]).toMatchObject({
      id: 'searchInInternet',
      position: 'right',
      tooltipKey: 'local.label',
    })
  })

  it('searches the text passed to the action menu item', async () => {
    const { actionItems, mocks } = setup({
      config: { url: 'https://example.com/?s=' },
    })

    await actionItems[0].action(' a&b ')

    expect(mocks.callApiFunction).toHaveBeenCalledWith('openInBrowserAndHide', [
      'https://example.com/?s=a%26b',
    ])
  })

  it('searches the selected text with the configured URL', async () => {
    const { mocks, toolbarItems } = setup({
      value: 'whole text',
      selectedText: ' a&b ',
      config: { url: 'https://example.com/?s=' },
    })

    await toolbarItems[0].action()

    expect(mocks.callApiFunction).toHaveBeenCalledWith('openInBrowserAndHide', [
      'https://example.com/?s=a%26b',
    ])
  })

  it('falls back to the whole text and the default URL', async () => {
    const { mocks, toolbarItems } = setup({ value: 'hello' })

    await toolbarItems[0].action()

    expect(mocks.callApiFunction).toHaveBeenCalledWith('openInBrowserAndHide', [
      `${DEFAULT_SEARCH_URL}hello`,
    ])
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
    isOutputRequested: false,
  })
  expect(result).toEqual({ ok: true, keepWindow: true })
  expect(mocks.callApiFunction).toHaveBeenCalledWith('openInBrowserAndHide', [
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

describe('buildSearchUrl', () => {
  it('puts the query at the placeholder or at the end', () => {
    expect(buildSearchUrl('https://x.org/s/{query}/all', 'a b')).toBe(
      'https://x.org/s/a%20b/all'
    )
    expect(buildSearchUrl(' https://x.org/?q= ', 'a&b')).toBe(
      'https://x.org/?q=a%26b'
    )
  })
})
