import type { PluginDefinition } from '@tyco/plugin-sdk'
import { locales } from './locales.js'
import {
  capitalizeFirst,
  sentenceCase,
  titleCase,
  invertCase,
  perLine,
  identifierToText,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toConstantCase,
  toKebabCase,
} from './text-case.js'
import type { InputConfigItem } from '@tyco/plugin-sdk'
import type { PluginContext } from '@tyco/plugin-sdk'

interface CaseTransform {
  action: (text: string) => string
  /** Identifier styles would turn a whole document into one identifier */
  selectionOnly?: boolean
}

const identifier = (transform: (text: string) => string): CaseTransform => ({
  action: perLine(transform),
  selectionOnly: true,
})

const transforms: Record<string, CaseTransform> = {
  capitalizeFirst: { action: capitalizeFirst },
  sentenceCase: { action: sentenceCase },
  titleCase: { action: titleCase },
  invertCase: { action: invertCase },
  identifierToText: identifier(identifierToText),
  camelCase: identifier(toCamelCase),
  pascalCase: identifier(toPascalCase),
  snakeCase: identifier(toSnakeCase),
  constantCase: identifier(toConstantCase),
  kebabCase: identifier(toKebabCase),
}

export default function pluginIndex(): PluginDefinition {
  return {
    id: 'TextCase',
    version: '0.1.0',
    apiVersion: 2,
    capabilities: ['editor'],
    defaultLocale: 'en-US',
    locales,
    labelKey: 'local.label',
    descriptionKey: 'local.description',
    defaultConfig: {
      fields: Object.keys(transforms).map((name): InputConfigItem => ({
        type: 'checkbox',
        name,
        labelKey: `local.${name}`,
        defaultValue: true,
      })),
    },
    init(ctx: PluginContext) {
      const config = ctx.getMyConfig<Record<string, boolean>>() ?? {}
      ctx.registerCaseItems(
        Object.entries(transforms)
          .filter(([id]) => config[id] !== false)
          .map(([id, { action, selectionOnly }]) => ({
            id: `case-${id}`,
            labelKey: `local.${id}`,
            ...(selectionOnly ? { selectionOnly } : {}),
            action,
          }))
      )
    },
  }
}
