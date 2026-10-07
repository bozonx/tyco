import { describe, expect, it } from 'vitest'
import type { EditItem } from '../../lib/edit-menu/edit-menu-store'
import { createPluginTestContext } from '../plugin-test-context'
import webFormatter from './index'

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
