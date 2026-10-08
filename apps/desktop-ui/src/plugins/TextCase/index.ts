import {
  capitalizeFirst,
  sentenceCase,
  identifierToText,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toConstantCase,
  toKebabCase,
} from '../../lib/text-case'
import type { InputConfigItem } from '../../types'
import type { PluginContext } from '../../types/plugins'

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

export default function pluginIndex() {
  return {
    name: 'TextCase',
    labelKey: 'plugin.textCase.label',
    descriptionKey: 'plugin.textCase.description',
    defaultConfig: {
      fields: Object.keys(transforms).map((name): InputConfigItem => ({
        type: 'checkbox',
        name,
        labelKey: `edit.${name}`,
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
            labelKey: `edit.${id}`,
            action,
          }))
      )
    },
  }
}
