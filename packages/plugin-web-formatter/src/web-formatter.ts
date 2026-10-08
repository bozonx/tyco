import { PluginError } from '@tyco/plugin-sdk'
import type { Options, Plugin } from 'prettier'

export const WEB_LANGUAGES = [
  'auto',
  'json',
  'javascript',
  'typescript',
  'html',
  'css',
  'scss',
  'less',
  'xml',
] as const
export type WebLanguage = (typeof WEB_LANGUAGES)[number]
export interface WebFormatterConfig {
  language: WebLanguage
  tabWidth: number
  useTabs: boolean
  printWidth: number
  singleQuote: boolean
  semi: boolean
  xmlWhitespaceSensitivity: 'strict' | 'preserve' | 'ignore'
}

export class WebFormatError extends PluginError {}

export function normalizeWebFormatterConfig(
  config: Partial<WebFormatterConfig> = {}
): WebFormatterConfig {
  const number = (
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ) => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= min && parsed <= max
      ? parsed
      : fallback
  }
  return {
    language: WEB_LANGUAGES.includes(config.language!)
      ? config.language!
      : 'auto',
    tabWidth: number(config.tabWidth, 2, 1, 8),
    printWidth: number(config.printWidth, 80, 40, 240),
    useTabs: config.useTabs === true,
    singleQuote: config.singleQuote === true,
    semi: config.semi !== false,
    xmlWhitespaceSensitivity: ['strict', 'preserve', 'ignore'].includes(
      config.xmlWhitespaceSensitivity ?? ''
    )
      ? config.xmlWhitespaceSensitivity!
      : 'preserve',
  }
}

/** Prefer explicit syntax; highlighting is only a conservative fallback. */
export async function detectWebLanguage(
  text: string
): Promise<Exclude<WebLanguage, 'auto'>> {
  const source = text.trim()
  try {
    JSON.parse(source)
    return 'json'
  } catch {
    /* Not JSON. */
  }
  if (/^(?:<\?xml\b|<!DOCTYPE\s+(?!html\b))/i.test(source)) return 'xml'
  if (/^(?:<!doctype\s+html\b|<!--|<[\w:.-]+[\s/>])/i.test(source)) {
    return /<(?:html|head|body|div|span|p|a|ul|ol|li|table|section|script|style|input|br|h[1-6])(?:\s|\/?>)/i.test(
      source
    )
      ? 'html'
      : 'xml'
  }
  if (
    /\b(?:const|let|var|function|interface|type|import|export|class)\s+[$\p{L}_]/u.test(
      source
    )
  )
    return 'typescript'
  if (/^\$[\w-]+\s*:/.test(source)) return 'scss'
  if (/^@[\w-]+\s*:\s*[^;]+;/.test(source)) return 'less'
  if (
    /^(?:[.#][\w-]+[^{}]*|@(?:media|supports|font-face|keyframes)\b[^{}]*|[a-z][\w-]*(?:\s*[,>+~]\s*[.#]?[\w-]+)*)\s*\{/i.test(
      source
    )
  ) {
    return /\$[\w-]+/.test(source) ? 'scss' : 'css'
  }
  const { default: hljs } = await import('highlight.js')
  const detected = hljs.highlightAuto(source)
  const language = detected.language
  const supported = ['javascript', 'typescript', 'css', 'scss', 'less'] as const
  if (
    !supported.includes(language as (typeof supported)[number]) ||
    detected.relevance < 5 ||
    (detected.secondBest &&
      detected.relevance - detected.secondBest.relevance < 2)
  ) {
    throw new WebFormatError('local.chooseLanguage')
  }
  return language as (typeof supported)[number]
}

/** Local parsers only: standalone Prettier has no network or filesystem access. */
export async function formatWebCode(
  text: string,
  config: Partial<WebFormatterConfig> = {}
): Promise<string> {
  const settings = normalizeWebFormatterConfig(config)
  if (!text.trim()) return text
  const language =
    settings.language === 'auto'
      ? await detectWebLanguage(text)
      : settings.language
  const { format } = await import('prettier/standalone')
  let parser: string = language
  let plugins: Plugin[]
  if (language === 'xml') {
    const { default: xml } = await import('@prettier/plugin-xml')
    plugins = [xml]
  } else if (['css', 'scss', 'less'].includes(language)) {
    plugins = [(await import('prettier/plugins/postcss')).default]
  } else {
    if (language === 'html') {
      // HTML can embed JavaScript, TypeScript and CSS.
      plugins = await Promise.all([
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
        import('prettier/plugins/typescript'),
        import('prettier/plugins/html'),
        import('prettier/plugins/postcss'),
      ]).then((modules) => modules.map((module) => module.default))
    } else if (language === 'typescript') {
      plugins = await Promise.all([
        import('prettier/plugins/typescript'),
        import('prettier/plugins/estree'),
      ]).then((modules) => modules.map((module) => module.default))
    } else {
      plugins = await Promise.all([
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]).then((modules) => modules.map((module) => module.default))
    }
    parser = language === 'javascript' ? 'babel' : language
  }
  try {
    return await format(text, {
      ...settings,
      parser,
      plugins,
      htmlWhitespaceSensitivity: 'css',
      xmlSortAttributesByKey: false,
    } as Options)
  } catch {
    throw new WebFormatError('local.invalidCode')
  }
}
