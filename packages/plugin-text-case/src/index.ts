import type { PluginDefinition } from '@tyco/plugin-sdk'
import { locales } from './locales.js'
import {
  capitalizeFirst,
  sentenceCase,
  identifierToText,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toConstantCase,
  toKebabCase,
} from './text-case.js'
import type { InputConfigItem } from '@tyco/plugin-sdk'
import type { PluginContext } from '@tyco/plugin-sdk'

const transforms = {
  capitalizeFirst,
  sentenceCase,
  identifierToText,
  camelCase: toCamelCase,
  pascalCase: toPascalCase,
  snakeCase: toSnakeCase,
  constantCase: toConstantCase,
  kebabCase: toKebabCase,
}

export default function pluginIndex(): PluginDefinition {
  return {
    id: 'TextCase',
    version: '0.1.0',
    apiVersion: 2,
    capabilities: ['editor'],
    defaultLocale: 'en_US',
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
          .map(([id, action]) => ({
            id: `case-${id}`,
            labelKey: `local.${id}`,
            action,
          }))
      )
    },
  }
}
