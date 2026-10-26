import { expect, it } from 'vitest'

import { createKeyPressTracker } from './key-press-tracker'

it('accepts only releases of keys pressed while tracking', () => {
  const keys = createKeyPressTracker()
  expect(keys.release('Enter')).toBe(false)
  keys.press('Enter')
  expect(keys.release('Enter')).toBe(true)
  expect(keys.release('Enter')).toBe(false)
})

it('forgets pressed keys when cleared', () => {
  const keys = createKeyPressTracker()
  keys.press('Space')
  keys.clear()
  expect(keys.release('Space')).toBe(false)
})
