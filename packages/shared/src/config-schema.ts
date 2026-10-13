import schemaValue from './user-config-schema.json'
import configDefaults from './user-config-defaults.json'
import configVersion from './config-version.json'
import type { UserConfig } from './user-config'

interface Schema {
  type?: string
  enum?: unknown[]
  anyOf?: Schema[]
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean | Schema
  items?: Schema
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  defaultPath?: string
  pattern?: string
  uniqueItems?: boolean
}

const schema = schemaValue as Schema
const portableDefaults: Record<string, unknown> = {
  ...configDefaults,
  configVersion,
}
const defaultOf = (shape: Schema) =>
  shape.defaultPath
    ? portableDefaults[shape.defaultPath]
    : (shape.default ?? null)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)

function valid(value: unknown, shape: Schema): boolean {
  if (shape.anyOf) return shape.anyOf.some((choice) => valid(value, choice))
  if (shape.enum && !shape.enum.some((choice) => equal(value, choice)))
    return false
  switch (shape.type) {
    case 'object':
      return (
        isRecord(value) &&
        (shape.required ?? []).every((key) => Object.hasOwn(value, key)) &&
        Object.entries(value).every(([key, item]) => {
          const child = shape.properties?.[key]
          if (child) return valid(item, child)
          if (shape.additionalProperties === false) return false
          return typeof shape.additionalProperties === 'object'
            ? valid(item, shape.additionalProperties)
            : true
        })
      )
    case 'array':
      return (
        Array.isArray(value) &&
        value.every(
          (item, index) =>
            valid(item, shape.items ?? {}) &&
            (!shape.uniqueItems ||
              !value.slice(0, index).some((previous) => equal(previous, item)))
        )
      )
    case 'string':
      return (
        typeof value === 'string' &&
        (shape.minLength === undefined ||
          [...value.trim()].length >= shape.minLength) &&
        (shape.maxLength === undefined ||
          [...value].length <= shape.maxLength) &&
        (shape.pattern === undefined || new RegExp(shape.pattern).test(value))
      )
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'number':
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (shape.type !== 'integer' || Number.isInteger(value)) &&
        (shape.minimum === undefined || value >= shape.minimum) &&
        (shape.maximum === undefined || value <= shape.maximum)
      )
    default:
      return true
  }
}

function repair(value: unknown, shape: Schema): unknown {
  if (shape.anyOf) {
    if (shape.anyOf.some((choice) => valid(value, choice))) return value
    const choice = shape.anyOf.find(
      (choice) =>
        choice.type === 'object' &&
        isRecord(value) &&
        (!choice.properties?.type?.enum ||
          choice.properties.type.enum.includes(value.type))
    )
    return choice ? repair(value, choice) : defaultOf(shape)
  }
  if (shape.type === 'object') {
    const source = isRecord(value)
      ? value
      : isRecord(defaultOf(shape))
        ? (defaultOf(shape) as Record<string, unknown>)
        : {}
    const result = { ...source }
    for (const key of shape.required ?? []) {
      if (!Object.hasOwn(result, key))
        result[key] = defaultOf(shape.properties?.[key] ?? {})
    }
    for (const [key, item] of Object.entries(result)) {
      const child = shape.properties?.[key]
      if (child) {
        const repaired = repair(item, child)
        if (!(shape.required ?? []).includes(key) && !valid(repaired, child))
          delete result[key]
        else result[key] = repaired
      } else if (shape.additionalProperties === false) delete result[key]
      else if (typeof shape.additionalProperties === 'object')
        result[key] = repair(item, shape.additionalProperties)
    }
    return result
  }
  if (shape.type === 'array') {
    const source = Array.isArray(value)
      ? value
      : Array.isArray(defaultOf(shape))
        ? (defaultOf(shape) as unknown[])
        : []
    const result: unknown[] = []
    for (const item of source) {
      const repaired = repair(item, shape.items ?? {})
      if (
        valid(repaired, shape.items ?? {}) &&
        (!shape.uniqueItems ||
          !result.some((previous) => equal(previous, repaired)))
      )
        result.push(repaired)
    }
    return result
  }
  return valid(value, shape) ? value : defaultOf(shape)
}

function deduplicate<T extends { id: string }>(
  items: (T | null)[],
  slots = false
): (T | null)[] {
  const seen = new Set<string>()
  const result = items.map((item) => {
    if (!item) return null
    if (seen.has(item.id)) return null
    seen.add(item.id)
    return item
  })
  return slots ? result : result.filter((item) => item !== null)
}

/** Domain adapters use the same field rules as the authoritative reader. */
export function normalizeConfigField<K extends keyof UserConfig>(
  key: K,
  value: unknown
): UserConfig[K] {
  return repair(value, schema.properties?.[key] ?? {}) as UserConfig[K]
}

/** Repairs known fields while preserving opaque plugin and tool settings. */
export function normalizeUserConfig(value: unknown): UserConfig {
  const config = repair(value, schema) as UserConfig
  for (const command of config.commands) {
    command.id = command.id.trim()
    command.toolId = command.toolId.trim()
  }
  for (const model of config.llm.models) model.id = model.id.trim()
  const builtinIds = ['google', 'openrouter', 'deepseek']
  config.llm.providers = config.llm.providers.filter((provider) =>
    builtinIds.includes(provider.id)
      ? provider.type === provider.id
      : provider.type === 'openai-compatible'
  )
  const builtins = configDefaults.llm.providers.filter((provider) =>
    builtinIds.includes(provider.id)
  )
  config.llm.providers = [
    ...builtins.map(
      (defaults) =>
        config.llm.providers.find((provider) => provider.id === defaults.id) ??
        ({ ...defaults } as UserConfig['llm']['providers'][number])
    ),
    ...config.llm.providers.filter(
      (provider) => !builtinIds.includes(provider.id)
    ),
  ]
  for (const provider of config.llm.providers) {
    if (provider.type === 'openai-compatible') provider.baseUrl ??= ''
    else delete provider.baseUrl
  }
  config.translation.glossary = config.translation.glossary
    .map((entry) => ({
      ...entry,
      term: entry.term.trim(),
      use: entry.use.trim(),
    }))
    .filter((entry) => entry.term.length > 0)
  config.commands = deduplicate(config.commands) as UserConfig['commands']
  for (const command of config.commands) {
    const toolSchema =
      command.toolId === 'script'
        ? schemaValue.$defs.scriptToolConfig
        : command.toolId === 'webhook'
          ? schemaValue.$defs.webhookToolConfig
          : undefined
    if (toolSchema)
      command.toolConfig = repair(
        command.toolConfig,
        toolSchema as Schema
      ) as Record<string, unknown>
  }
  config.aiTasks = deduplicate(config.aiTasks, true)
  config.sttModels = deduplicate(config.sttModels) as UserConfig['sttModels']
  config.llm.providers = deduplicate(
    config.llm.providers
  ) as UserConfig['llm']['providers']
  config.llm.models = deduplicate(
    config.llm.models
  ) as UserConfig['llm']['models']
  const providers = new Set(config.llm.providers.map((provider) => provider.id))
  config.llm.models = config.llm.models.filter((model) =>
    providers.has(model.providerId)
  )
  const models = new Set(config.llm.models.map((model) => model.id))
  for (const task of Object.keys(
    config.llm.tasks
  ) as (keyof UserConfig['llm']['tasks'])[])
    config.llm.tasks[task] = config.llm.tasks[task].filter((id) =>
      models.has(id)
    )
  const commands = new Set(config.commands.map((command) => command.id))
  const tasks = new Set(
    config.aiTasks.flatMap((task) => (task ? [task.id] : []))
  )
  const pageCount = config.launcherPages?.length ?? 0
  config.mainActions = config.mainActions.map((slot) => {
    if (slot?.type === 'command' && !commands.has(slot.commandId)) return null
    if (slot?.type === 'aiTask' && !tasks.has(slot.taskId)) return null
    if (slot?.type === 'launcherPage' && slot.page > pageCount) return null
    return slot
  })
  const cleanSlots = (slots: (string | null)[]) =>
    slots.map((id) => (id && commands.has(id) ? id : null))
  config.launcherCommands = cleanSlots(config.launcherCommands)
  if (config.launcherPages)
    config.launcherPages = config.launcherPages.map(cleanSlots)
  if (config.launcherPagesWithoutText)
    config.launcherPagesWithoutText = config.launcherPagesWithoutText.filter(
      (page) => page <= pageCount
    )
  if (!config.sttModels.some((model) => model.id === config.selectedSttModelId))
    config.selectedSttModelId = config.sttModels[0]?.id ?? ''
  return config
}

/** The backend repeats this check before writing the authoritative file. */
export function isUserConfig(value: unknown): value is UserConfig {
  if (!valid(value, schema)) return false
  const config = value as UserConfig
  if (config.configVersion !== configVersion) return false
  for (const command of config.commands) {
    const toolSchema =
      command.toolId === 'script'
        ? schemaValue.$defs.scriptToolConfig
        : command.toolId === 'webhook'
          ? schemaValue.$defs.webhookToolConfig
          : undefined
    if (toolSchema && !valid(command.toolConfig, toolSchema as Schema))
      return false
    if (
      command.toolId === 'webhook' &&
      command.toolConfig.authSecret === true &&
      typeof command.toolConfig.authSecretId !== 'string'
    )
      return false
  }
  return equal(normalizeUserConfig(value), value)
}
