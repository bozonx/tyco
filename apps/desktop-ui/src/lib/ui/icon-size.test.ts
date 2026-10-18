import { expect, it } from 'vitest'

import { iconSizeLength } from './icon-size'

it('expresses icon sizes in rem so they follow interface scaling', () => {
  expect(iconSizeLength('md')).toBe('1rem')
  expect(iconSizeLength('sm')).toBe('0.875rem')
  expect(iconSizeLength('4xl')).toBe('2rem')
})
