import { describe, expect, it } from 'vitest'

import {
  identifierToText,
  capitalizeFirst,
  invertCase,
  perLine,
  titleCase,
  sentenceCase,
  toCamelCase,
  toConstantCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
} from './text-case.js'

const transforms = [
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toKebabCase,
  toConstantCase,
  identifierToText,
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
    expect(identifierToText('HELLO')).toBe('Hello')
    expect(toSnakeCase('XMLHttpRequest')).toBe('xml_http_request')
    expect(toConstantCase('getHTTPResponse')).toBe('GET_HTTP_RESPONSE')
    expect(toCamelCase('HTTPServer')).toBe('httpServer')
    expect(toSnakeCase('version2Value')).toBe('version2_value')
  })

  it('normalizes mixed separators together', () => {
    expect(identifierToText('hello_world-test\tvalue')).toBe(
      'Hello world test value'
    )
  })

  it('handles Unicode letters and combining marks', () => {
    expect(toPascalCase('\u{10428} test')).toBe('\u{10400}Test')
    expect(identifierToText('\u{10428} test')).toBe('\u{10400} test')
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

describe('prose case transforms', () => {
  it('capitalizes only the first letter while preserving existing case', () => {
    expect(capitalizeFirst('  hello NASA. next\nline')).toBe(
      '  Hello NASA. next\nline'
    )
  })
  it('capitalizes sentences without removing separators or paragraphs', () => {
    expect(
      sentenceCase('HELLO. HOW ARE YOU? FINE!\n\nSNAKE_CASE AND WELL-KNOWN.')
    ).toBe('Hello. How are you? Fine!\n\nSnake_case and well-known.')
  })
})

describe('title and inverted case', () => {
  it('capitalizes every word and keeps separators', () => {
    expect(
      titleCase("HELLO wORLD, don't stop-now\n\u0431\u0443\u043a\u0432\u044b")
    ).toBe("Hello World, Don't Stop-Now\n\u0411\u0443\u043a\u0432\u044b")
  })

  it('swaps the case of every letter only', () => {
    expect(
      invertCase('Hello World 42! \u041f\u0440\u0438\u0432\u0435\u0442')
    ).toBe('hELLO wORLD 42! \u043f\u0420\u0418\u0412\u0415\u0422')
    expect(invertCase(invertCase('MiXeD'))).toBe('MiXeD')
  })
})

describe('per-line identifier transforms', () => {
  it('keeps lines, indentation and blank lines', () => {
    expect(perLine(toCamelCase)('hello world\n\n  foo_bar \r\nbaz')).toBe(
      'helloWorld\n\n  fooBar \r\nbaz'
    )
  })

  it('leaves lines without words unchanged', () => {
    expect(perLine(toSnakeCase)('a b\n -- \n')).toBe('a_b\n -- \n')
  })
})
