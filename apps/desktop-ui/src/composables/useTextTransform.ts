import {
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toKebabCase,
  toConstantCase,
  normalizeText,
} from '@/lib/text-case'

export function useTextTransform() {
  const toUppercase = (text?: string): string => {
    if (!text) return ''

    return text.toUpperCase()
  }

  const toLowercase = (text?: string): string => {
    if (!text) return ''

    return text.toLowerCase()
  }

  const doCaseTransform = (text: string, caseType: string): string => {
    switch (caseType) {
      case 'normalize':
        return normalizeText(text)
      case 'uppercase':
        return toUppercase(text)
      case 'lowercase':
        return toLowercase(text)
      case 'camelCase':
        return toCamelCase(text)
      case 'pascalCase':
        return toPascalCase(text)
      case 'snakeCase':
        return toSnakeCase(text)
      case 'constantCase':
        return toConstantCase(text)
      case 'kebabCase':
        return toKebabCase(text)
    }

    return text
  }

  return { doCaseTransform }
}
