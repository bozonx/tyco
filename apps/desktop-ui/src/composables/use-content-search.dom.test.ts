import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useContentSearch } from './use-content-search'

describe('use-content-search', () => {
  it('opens and closes via method and handles Ctrl+F shortcut', async () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>Searchable sample message</p>'
    document.body.appendChild(container)

    const containerRef = ref<HTMLElement | null>(container)
    const search = useContentSearch({ containerRef })

    expect(search.isOpen.value).toBe(false)

    // Trigger Ctrl+F
    const ctrlF = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(ctrlF)
    expect(search.isOpen.value).toBe(true)

    search.query.value = 'sample'
    await nextTick()

    expect(search.count.value).toBe(1)
    expect(search.activeIndex.value).toBe(0)

    // Escape closes search
    const esc = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(esc)
    expect(search.isOpen.value).toBe(false)

    search.destroy()
    document.body.removeChild(container)
  })
})
