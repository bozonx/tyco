import { describe, expect, it, vi } from 'vitest'

import { createEditMenuStoreModel } from './edit-menu-store'

describe('createEditMenuStoreModel', () => {
  const setup = () => {
    const deps = {
      doCaseTransform: vi.fn(
        (text: string, caseType: string) => `${caseType}:${text}`
      ),
      formatMdAndStyle: vi.fn(async (text: string) => `md:${text}`),
      formatSomeCode: vi.fn(async (text: string) => `code:${text}`),
    }
    const store = createEditMenuStoreModel(deps)
    return { store, deps }
  }

  it('provides default case and format items', () => {
    const { store } = setup()

    const caseItems = store.getCaseItems()
    expect(caseItems).toHaveLength(7)
    expect(caseItems.map((c) => c.labelKey)).toContain('edit.uppercase')
    expect(caseItems.map((c) => c.labelKey)).toContain('edit.snakeCase')

    const formatItems = store.getFormatItems()
    expect(formatItems).toHaveLength(2)
    expect(formatItems.map((f) => f.labelKey)).toContain('edit.beautifyMd')
    expect(formatItems.map((f) => f.labelKey)).toContain('edit.formatCode')
  })

  it('executes case and format transforms via dependencies', async () => {
    const { store, deps } = setup()

    const upperCaseItem = store
      .getCaseItems()
      .find((i) => i.labelKey === 'edit.uppercase')
    const result = await upperCaseItem?.action('hello')
    expect(deps.doCaseTransform).toHaveBeenCalledWith('hello', 'uppercase')
    expect(result).toBe('uppercase:hello')

    const mdItem = store
      .getFormatItems()
      .find((i) => i.labelKey === 'edit.beautifyMd')
    const mdResult = await mdItem?.action('# Hello')
    expect(deps.formatMdAndStyle).toHaveBeenCalledWith('# Hello')
    expect(mdResult).toBe('md:# Hello')
  })

  it('allows registering case, format, and other edit items', () => {
    const { store } = setup()

    const customCase = {
      id: 'case-title',
      labelKey: 'edit.titleCase',
      action: vi.fn(),
    }
    store.registerCaseItems([customCase])
    expect(store.getCaseItems()).toContain(customCase)

    const customFormat = {
      id: 'format-json',
      labelKey: 'edit.beautifyJson',
      action: vi.fn(),
    }
    store.registerFormatItems([customFormat])
    expect(store.getFormatItems()).toContain(customFormat)

    const customEdit = {
      id: 'edit-stress',
      labelKey: 'plugin.russianStress.label',
      action: vi.fn(),
    }
    store.registerEditItems([customEdit])
    expect(store.getOtherEditItems()).toContain(customEdit)

    const allEditItems = store.getEditMenu()
    expect(allEditItems).toContain(customCase)
    expect(allEditItems).toContain(customFormat)
    expect(allEditItems).toContain(customEdit)
  })

  it('allows clearing registered items', () => {
    const { store } = setup()

    const customCase = {
      id: 'case-title',
      labelKey: 'edit.titleCase',
      action: vi.fn(),
    }
    const customFormat = {
      id: 'format-json',
      labelKey: 'edit.beautifyJson',
      action: vi.fn(),
    }
    const customEdit = {
      id: 'edit-stress',
      labelKey: 'plugin.russianStress.label',
      action: vi.fn(),
    }

    store.registerCaseItems([customCase])
    store.registerFormatItems([customFormat])
    store.registerEditItems([customEdit])

    store.clearRegisteredItems()

    expect(store.getCaseItems()).not.toContain(customCase)
    expect(store.getFormatItems()).not.toContain(customFormat)
    expect(store.getOtherEditItems()).not.toContain(customEdit)
    expect(store.getOtherEditItems()).toHaveLength(0)
  })
})
