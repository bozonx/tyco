import { describe, expect, it, vi } from 'vitest'
import {
  detectWebLanguage,
  formatWebCode,
  normalizeWebFormatterConfig,
  WebFormatError,
} from './web-formatter'

describe('web code formatter', () => {
  it.each([
    ['json', '{"a":1,"b":[2,3]}'],
    ['javascript', 'function f(){return {a:1}}'],
    ['typescript', 'interface User{name:string;age:number}'],
    [
      'html',
      '<div><script>const x={a:1};</script><style>.a{color:red}</style></div>',
    ],
    ['css', '.a{color:red;background:white}'],
    ['scss', '$color:red;.a{color:$color;&:hover{color:blue}}'],
    ['less', '@color:red;.a{color:@color}'],
    ['xml', '<?xml version="1.0"?><root><item a="1" b="2"/></root>'],
  ] as const)('formats %s and is idempotent', async (language, input) => {
    const config = { language, xmlWhitespaceSensitivity: 'preserve' as const }
    const output = await formatWebCode(input, config)
    expect(output).not.toBe(input)
    expect(await formatWebCode(output, config)).toBe(output)
  })
  it('preserves XML text, attributes and mixed content in strict mode', async () => {
    const input =
      '<root b="2" a="1">Hello <b>world</b> !<![CDATA[x < y]]></root>'
    const output = await formatWebCode(input, {
      language: 'xml',
      xmlWhitespaceSensitivity: 'strict',
    })
    expect(output.trim()).toBe(input)
  })
  it('rejects malformed XML and JSON without returning transformed text', async () => {
    await expect(
      formatWebCode('<root><item></root>', { language: 'xml' })
    ).rejects.toBeInstanceOf(WebFormatError)
    await expect(
      formatWebCode('{"a":}', { language: 'json' })
    ).rejects.toBeInstanceOf(WebFormatError)
  })
  it('detects JSON, XML, HTML and TypeScript', async () => {
    expect(await detectWebLanguage('{"x":1}')).toBe('json')
    expect(await detectWebLanguage('<root><item/></root>')).toBe('xml')
    expect(await detectWebLanguage('<div>Hello</div>')).toBe('html')
    expect(await detectWebLanguage('const x:number=1')).toBe('typescript')
  })
  it('rejects unsupported languages and ambiguous prose', async () => {
    await expect(
      formatWebCode('def greet(name):\n    print(name)')
    ).rejects.toBeInstanceOf(WebFormatError)
    await expect(formatWebCode('Hello world.')).rejects.toBeInstanceOf(
      WebFormatError
    )
  })
  it('supports formatting without dynamic evaluation required by CSP', async () => {
    const evaluate = vi.spyOn(globalThis, 'eval').mockImplementation(() => {
      throw Error('CSP blocked eval')
    })
    try {
      expect(await formatWebCode('<root/>', { language: 'xml' })).toContain(
        '<root />'
      )
    } finally {
      evaluate.mockRestore()
    }
  })
  it('uses formatter settings and validates numeric settings from text inputs', async () => {
    expect(
      normalizeWebFormatterConfig({ tabWidth: 99, printWidth: NaN }).tabWidth
    ).toBe(2)
    expect(
      await formatWebCode('const x={a:"b"}', {
        language: 'javascript',
        singleQuote: true,
        semi: false,
        tabWidth: 4,
      })
    ).toBe("const x = { a: 'b' }\n")
  })
})

describe('automatic stylesheet selection', () => {
  it.each([
    ['.a{color:red}', 'css'],
    ['body{color:red}', 'css'],
    ['$color:red;.a{color:$color}', 'scss'],
    ['@color:red;.a{color:@color}', 'less'],
  ])('recognizes %s', async (input, language) => {
    expect(await detectWebLanguage(input)).toBe(language)
    expect(await formatWebCode(input)).toContain('color:')
  })
})
