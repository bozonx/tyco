import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ShortcutKeys from './ShortcutKeys.vue'

describe('ShortcutKeys', () => {
  it('distinguishes alternative keys from a modifier chord', () => {
    const alternatives = mount(ShortcutKeys, {
      props: { keys: ['Space', 'Enter'] },
    })
    expect(alternatives.text()).toBe('Space,Enter')
    const chord = mount(ShortcutKeys, { props: { keys: ['Shift', 'Space'] } })
    expect(chord.text()).toBe('Shift+Space')
  })
})
