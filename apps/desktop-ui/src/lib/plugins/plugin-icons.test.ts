import { expect, it } from 'vitest'
import { createPluginIcons } from './plugin-icons'

it('replaces collections atomically and releases removed plugin icons', () => {
  const icons = createPluginIcons()
  icons.register({
    prefix: 'first',
    width: 24,
    icons: { old: { body: '<path/>' } },
  })
  icons.register({ prefix: 'second', icons: { other: { body: '<circle/>' } } })
  expect(icons.resolve('first:old')).toMatchObject({ width: 24 })
  icons.register({ prefix: 'first', icons: { next: { body: '<rect/>' } } })
  expect(icons.resolve('first:old')).toBeUndefined()
  expect(icons.resolve('first:next')).toBeDefined()
  icons.remove('first')
  expect(icons.resolve('first:next')).toBeUndefined()
  expect(icons.resolve('second:other')).toBeDefined()
})
