import schemaValue from './user-config-schema.json' with { type: 'json' }
import configDefaults from './user-config-defaults.json' with { type: 'json' }
import configVersion from './config-version.json' with { type: 'json' }
import {
  BUILTIN_LLM_PROVIDERS,
  LLM_TASKS,
  SHORTCUT_SLOT_KEYS,
  type ShortcutSlots,
  type UserConfig,
  type UserConfigInput,
} from './user-config'

interface Schema {
  minItems?: number
  maxItems?: number
  type?: string
  enum?: unknown[]
  anyOf?: Schema[]
  properties?: Record<string, Schema>
  propertyNames?: Schema
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

const schema = schemaValue as unknown as Schema
const portableDefaults: Record<string, unknown> = {
  configVersion,
  ...configDefaults,
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
          if (shape.propertyNames && !valid(key, shape.propertyNames))
            return false
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
        (shape.minItems === undefined || value.length >= shape.minItems) &&
        (shape.maxItems === undefined || value.length <= shape.maxItems) &&
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
      if (shape.propertyNames && !valid(key, shape.propertyNames)) {
        delete result[key]
        continue
      }
      const child = shape.properties?.[key]
      if (child) {
        const repaired = repair(item, child)
        if (!(shape.required ?? []).includes(key) && !valid(repaired, child))
          delete result[key]
        else result[key] = repaired
      } else if (shape.additionalProperties === false) delete result[key]
      else if (typeof shape.additionalProperties === 'object') {
        const repaired = repair(item, shape.additionalProperties)
        if (valid(repaired, shape.additionalProperties)) result[key] = repaired
        else delete result[key]
      }
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
    if (shape.maxItems !== undefined)
      result.length = Math.min(result.length, shape.maxItems)
    while (shape.minItems !== undefined && result.length < shape.minItems) {
      const item = repair(defaultOf(shape.items ?? {}), shape.items ?? {})
      if (!valid(item, shape.items ?? {}))
        return repair(defaultOf(shape), { ...shape, minItems: undefined })
      result.push(item)
    }
    return result
  }
  return valid(value, shape) ? value : defaultOf(shape)
}

function deduplicate<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/** Keeps the slots whose value passes `keep`, in the order of the keys. */
function filterSlots<T>(
  slots: ShortcutSlots<T>,
  keep: (value: T) => boolean
): ShortcutSlots<T> {
  const result: ShortcutSlots<T> = {}
  for (const key of SHORTCUT_SLOT_KEYS) {
    const value = slots[key]
    if (value !== undefined && keep(value)) result[key] = value
  }
  return result
}

/** Keeps the first slot of each value. */
function distinctSlots<T>(slots: ShortcutSlots<T>): ShortcutSlots<T> {
  const seen = new Set<T>()
  return filterSlots(slots, (value) => {
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

/** The schema of a field, e.g. `markdown.strip`. */
function schemaAt(path: string): Schema {
  return path
    .split('.')
    .reduce<Schema>((shape, key) => shape.properties?.[key] ?? {}, schema)
}

/** Domain adapters use the same field rules as the authoritative reader. */
export function normalizeConfigField<K extends keyof UserConfig>(
  key: K,
  value: unknown
): UserConfig[K] {
  return repair(value, schemaAt(key)) as UserConfig[K]
}

/**
 * A nested field repaired by the schema, e.g. `markdown.strip`; a missing value
 * takes the default of the field
 */
export function normalizeConfigValue<T>(path: string, value: unknown): T {
  const shape = schemaAt(path)
  const fallback = path
    .split('.')
    .reduce<unknown>(
      (defaults, key) => (isRecord(defaults) ? defaults[key] : undefined),
      portableDefaults
    )
  return repair(value ?? fallback, shape) as T
}

/**
 * The LLM section: built-in providers first, each once and of its own type,
 * models of existing providers, task chains of existing models
 */
export function normalizeLlmConfig(value: unknown): UserConfig['llm'] {
  const llm = repair(value, schemaAt('llm')) as UserConfig['llm']
  for (const model of llm.models) model.id = model.id.trim()
  const builtinIds: readonly string[] = BUILTIN_LLM_PROVIDERS
  llm.providers = llm.providers.filter((provider) =>
    builtinIds.includes(provider.id)
      ? provider.type === provider.id
      : provider.type === 'openaiCompatible'
  )
  const builtins = configDefaults.llm.providers.filter((provider) =>
    builtinIds.includes(provider.id)
  )
  llm.providers = deduplicate([
    ...builtins.map(
      (defaults) =>
        llm.providers.find((provider) => provider.id === defaults.id) ??
        ({ ...defaults } as UserConfig['llm']['providers'][number])
    ),
    ...llm.providers.filter((provider) => !builtinIds.includes(provider.id)),
  ])
  for (const provider of llm.providers) {
    if (provider.type === 'openaiCompatible') provider.baseUrl ??= ''
    else delete provider.baseUrl
  }
  const providers = new Set(llm.providers.map((provider) => provider.id))
  llm.models = deduplicate(llm.models).filter((model) =>
    providers.has(model.providerId)
  )
  const models = new Set(llm.models.map((model) => model.id))
  for (const task of LLM_TASKS)
    llm.taskModelChains[task] = llm.taskModelChains[task].filter((id) =>
      models.has(id)
    )
  return llm
}

/**
 * The command library: trimmed ids, each once, with the tool settings of the
 * built-in tools repaired
 */
export function normalizeCommands(value: unknown): UserConfig['commands'] {
  const commands = repair(value, schemaAt('commands')) as UserConfig['commands']
  for (const command of commands) {
    command.id = command.id.trim()
    command.toolId = command.toolId.trim()
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
  return deduplicate(commands)
}

/** Repairs known fields while preserving opaque plugin and tool settings. */
export function normalizeUserConfig(value: UserConfigInput): UserConfig {
  const config = repair(value, schema) as UserConfig
  config.configVersion = configVersion
  config.commands = normalizeCommands(config.commands)
  config.llm = normalizeLlmConfig(config.llm)
  config.translation.glossary = config.translation.glossary
    .map((entry) => ({
      ...entry,
      term: entry.term.trim(),
      use: entry.use.trim(),
    }))
    .filter((entry) => entry.term.length > 0)
  config.translation.targetLanguages = distinctSlots(
    config.translation.targetLanguages
  )
  config.aiTasks = deduplicate(config.aiTasks)
  const taskIds = new Set(config.aiTasks.map((task) => task.id))
  config.aiTaskSlots = distinctSlots(
    filterSlots(config.aiTaskSlots, (id) => taskIds.has(id))
  )
  const commands = new Set(config.commands.map((command) => command.id))
  config.launcherPages = deduplicate(config.launcherPages)
  const pageIds = new Set(config.launcherPages.map((page) => page.id))
  config.mainActions = filterSlots(config.mainActions, (slot) => {
    if (slot.type === 'command') return commands.has(slot.commandId)
    if (slot.type === 'aiTask') return taskIds.has(slot.taskId)
    if (slot.type === 'launcherPage') return pageIds.has(slot.pageId)
    return true
  })
  for (const page of config.launcherPages)
    page.slots = filterSlots(page.slots, (id) => commands.has(id))
  return config
}
