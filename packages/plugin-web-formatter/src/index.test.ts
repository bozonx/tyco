import { describe, expect, it } from 'vitest'
import type { EditItem } from '@tyco/plugin-sdk'
import { createPluginTestContext } from '@tyco/plugin-sdk/testing'
import webFormatter from './index.js'

describe('web formatter plugin', () => {
  it('registers one command and uses its language settings', async () => {
    const { ctx, mocks } = createPluginTestContext({
      config: {
        language: 'xml',
        tabWidth: 4,
        xmlWhitespaceSensitivity: 'preserve',
      },
    })
    webFormatter().init(ctx)
    const items = mocks.registerFormatItems.mock.calls[0]![0] as EditItem[]
    expect(items).toHaveLength(1)
    expect(await items[0]!.action('<root><item/></root>')).toBe(
      '<root>\n    <item />\n</root>\n'
    )
  })
})
