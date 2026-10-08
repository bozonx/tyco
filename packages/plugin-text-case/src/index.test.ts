import { describe, expect, it } from 'vitest'
import type { EditItem } from '@tyco/plugin-sdk'
import { createPluginTestContext } from '@tyco/plugin-sdk/testing'
import textCase from './index.js'

describe('text case plugin', () => {
  it('only registers enabled operations', async () => {
    const { ctx, mocks } = createPluginTestContext({
      config: { snakeCase: false, sentenceCase: false },
    })
    textCase().init(ctx)
    const items = mocks.registerCaseItems.mock.calls[0]![0] as EditItem[]
    expect(items.some((item) => item.id === 'case-snakeCase')).toBe(false)
    expect(items.some((item) => item.id === 'case-sentenceCase')).toBe(false)
    expect(
      await items
        .find((item) => item.id === 'case-identifierToText')!
        .action('HTTPServer_error')
    ).toBe('Http server error')
  })
})
