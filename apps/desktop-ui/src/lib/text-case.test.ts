import { describe, expect, it } from 'vitest'

import {
  normalizeText,
  toCamelCase,
  toConstantCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
} from './text-case'

const transforms = [
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toKebabCase,
  toConstantCase,
  normalizeText,
]

describe('text case transforms', () => {
  it.each([
    'hello world',
    'helloWorld',
    'HelloWorld',
    'HELLO_WORLD',
    'hello_world',
    'hello-world',
    ' \t_hello__world-\n ',
    'hello\nworld',
  ])('converts %j consistently', (input) => {
    expect(transforms.map((transform) => transform(input))).toEqual([
      'helloWorld',
      'HelloWorld',
      'hello_world',
      'hello-world',
      'HELLO_WORLD',
      'Hello world',
    ])
  })

  it.each([undefined, '', ' \t\n_- '])('handles empty input %j', (input) => {
    expect(transforms.map((transform) => transform(input))).toEqual(
      transforms.map(() => '')
    )
  })

  it('keeps acronyms together and splits their trailing words', () => {
    expect(normalizeText('HELLO')).toBe('Hello')
    expect(toSnakeCase('XMLHttpRequest')).toBe('xml_http_request')
    expect(toConstantCase('getHTTPResponse')).toBe('GET_HTTP_RESPONSE')
    expect(toCamelCase('HTTPServer')).toBe('httpServer')
    expect(toSnakeCase('version2Value')).toBe('version2_value')
  })

  it('normalizes mixed separators together', () => {
    expect(normalizeText('hello_world-test\tvalue')).toBe(
      'Hello world test value'
    )
  })

  it('handles Unicode letters and combining marks', () => {
    expect(toPascalCase('\u{10428} test')).toBe('\u{10400}Test')
    expect(normalizeText('\u{10428} test')).toBe('\u{10400} test')
    expect(toSnakeCase('\u{10428}Test')).toBe('\u{10428}_test')
    expect(toSnakeCase('cafe\u0301World')).toBe('cafe\u0301_world')
    expect(toPascalCase('cafe\u0301 world')).toBe('Cafe\u0301World')
    expect(
      toSnakeCase('\u043f\u0440\u0438\u0432\u0435\u0442\u041c\u0438\u0440')
    ).toBe('\u043f\u0440\u0438\u0432\u0435\u0442_\u043c\u0438\u0440')
  })

  it('is stable when a transformation is applied again', () => {
    for (const transform of transforms) {
      const result = transform('XMLHttpRequest hello-world')
      expect(transform(result)).toBe(result)
    }
  })
})
