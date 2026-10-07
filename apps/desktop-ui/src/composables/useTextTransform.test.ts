import { describe, expect, it } from 'vitest'

import { useTextTransform } from './useTextTransform'

describe('useTextTransform', () => {
  const { doCaseTransform } = useTextTransform()

  it.each([
    ['normalize', 'Hello world'],
    ['uppercase', 'HELLO WORLD'],
    ['lowercase', 'hello world'],
    ['camelCase', 'helloWorld'],
    ['pascalCase', 'HelloWorld'],
    ['snakeCase', 'hello_world'],
    ['kebabCase', 'hello-world'],
    ['constantCase', 'HELLO_WORLD'],
  ])('dispatches %s to the real implementation', (type, expected) => {
    expect(doCaseTransform('hello world', type)).toBe(expected)
  })

  it('preserves whitespace for upper and lower case', () => {
    expect(doCaseTransform(' Hello\nWorld ', 'uppercase')).toBe(
      ' HELLO\nWORLD '
    )
    expect(doCaseTransform(' Hello\nWorld ', 'lowercase')).toBe(
      ' hello\nworld '
    )
  })

  it('preserves input for unknown transforms', () => {
    expect(doCaseTransform('helloWorld', 'unknown')).toBe('helloWorld')
  })
})
