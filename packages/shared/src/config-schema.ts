import { isRecord } from './value-guards'
import schemaValue from './user-config-schema.json' with { type: 'json' }
import configDefaults from './user-config-defaults.json' with { type: 'json' }
import configVersion from './config-version.json' with { type: 'json' }
import {
  BUILTIN_LLM_PROVIDERS,
  LLM_TASKS,
  normalizeGlossaryEntry,
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
  /** `device`: the field belongs to this device and is never synced */
  'x-scope'?: 'device'
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
 * models of existing providers, task models that exist
 */
export function normalizeLlmConfig(value: unknown): UserConfig['llm'] {
  const llm = repair(value, schemaAt('llm')) as UserConfig['llm']
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
  for (const provider of llm.providers)
    if (provider.type !== 'openaiCompatible') delete provider.baseUrl
  const providers = new Set(llm.providers.map((provider) => provider.id))
  llm.models = deduplicate(llm.models).filter((model) =>
    providers.has(model.providerId)
  )
  const models = new Set(llm.models.map((model) => model.id))
  if (llm.commonModelId && !models.has(llm.commonModelId)) {
    llm.commonModelId = ''
  }
  if (llm.customTaskModels) {
    for (const task of LLM_TASKS) {
      if (
        llm.customTaskModels[task] &&
        !models.has(llm.customTaskModels[task]!)
      ) {
        llm.customTaskModels[task] = ''
      }
    }
  }
  for (const task of LLM_TASKS)
    if (!models.has(llm.tasks[task].modelId)) llm.tasks[task].modelId = ''
  return llm
}

const MAX_COMMAND_ID_LENGTH = 64

const commandIdPattern = new RegExp(
  (schemaAt('commands').items?.properties?.id?.pattern as string | undefined) ??
    '^[a-z0-9][a-z0-9._-]{0,63}$'
)

/**
 * A valid command id made of an invalid one: ASCII letters in lower case, each
 * run of other characters as one `-`, without leading or trailing punctuation.
 * Keep in sync with `command_id_from` in `services/settings/schema.rs`
 */
function commandIdFrom(id: string): string {
  return id
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, MAX_COMMAND_ID_LENGTH)
}

/** Keep in sync with `is_blank_id` in `services/settings/schema.rs` */
const isBlankId = (id: string): boolean => /^[ \t\n\r]*$/.test(id)

/**
 * New ids for the commands whose id breaks the schema, which would drop them:
 * e.g. `MyCmd` of a config edited by hand becomes `mycmd`. Each new id is
 * unique; repeats of one invalid id get the same new id, as they were
 * duplicates before
 */
function commandIdRepairs(commands: unknown): Map<string, string> {
  const repairs = new Map<string, string>()
  if (!Array.isArray(commands)) return repairs
  const ids = commands.flatMap((command) =>
    isRecord(command) && typeof command.id === 'string' ? [command.id] : []
  )
  const taken = new Set(ids.filter((id) => commandIdPattern.test(id)))
  for (const id of ids) {
    // a blank id is no id: such a command stays dropped
    if (commandIdPattern.test(id) || repairs.has(id) || isBlankId(id)) continue
    const base = commandIdFrom(id) || 'command'
    let candidate = base
    for (let index = 2; taken.has(candidate); index += 1) {
      const suffix = `-${index}`
      candidate = `${base.slice(0, MAX_COMMAND_ID_LENGTH - suffix.length)}${suffix}`
    }
    taken.add(candidate)
    repairs.set(id, candidate)
  }
  return repairs
}

const withRepairedId = (
  command: unknown,
  repairs: Map<string, string>
): unknown =>
  isRecord(command) && typeof command.id === 'string' && repairs.has(command.id)
    ? { ...command, id: repairs.get(command.id) }
    : command

/**
 * The raw config with valid ids for its commands, the menu items and launcher
 * keys of those commands following them
 */
function repairCommandIds(value: unknown): unknown {
  if (!isRecord(value)) return value
  const repairs = commandIdRepairs(value.commands)
  if (!repairs.size) return value
  const result: Record<string, unknown> = {
    ...value,
    commands: (value.commands as unknown[]).map((command) =>
      withRepairedId(command, repairs)
    ),
  }
  if (isRecord(value.mainActions)) {
    result.mainActions = Object.fromEntries(
      Object.entries(value.mainActions).map(([key, slot]) => [
        key,
        isRecord(slot) &&
        slot.type === 'command' &&
        typeof slot.commandId === 'string' &&
        repairs.has(slot.commandId)
          ? { ...slot, commandId: repairs.get(slot.commandId) }
          : slot,
      ])
    )
  }
  if (Array.isArray(value.launcherPages)) {
    result.launcherPages = value.launcherPages.map((page: unknown) =>
      isRecord(page) && isRecord(page.slots)
        ? {
            ...page,
            slots: Object.fromEntries(
              Object.entries(page.slots).map(([key, id]) => [
                key,
                typeof id === 'string' ? (repairs.get(id) ?? id) : id,
              ])
            ),
          }
        : page
    )
  }
  return result
}

/**
 * The command library: each id once, with the tool settings of the built-in
 * tools repaired; an invalid id is repaired rather than the command dropped
 */
export function normalizeCommands(value: unknown): UserConfig['commands'] {
  const repairs = commandIdRepairs(value)
  const source = repairs.size
    ? (value as unknown[]).map((command) => withRepairedId(command, repairs))
    : value
  const commands = repair(
    source,
    schemaAt('commands')
  ) as UserConfig['commands']
  for (const command of commands) {
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

/**
 * Repairs known fields; unknown ones, e.g. of a newer build, are kept as they
 * are, as are the opaque plugin and tool settings
 */
export function normalizeUserConfig(value: UserConfigInput): UserConfig {
  const config = repair(repairCommandIds(value), schema) as UserConfig
  config.configVersion = configVersion
  config.commands = normalizeCommands(config.commands)
  config.llm = normalizeLlmConfig(config.llm)
  config.translation.glossary = config.translation.glossary.flatMap(
    (entry) => normalizeGlossaryEntry(entry) ?? []
  )
  config.translation.targetLanguages = distinctSlots(
    config.translation.targetLanguages
  )
  config.transformations.items = deduplicate(config.transformations.items)
  const transformationIds = new Set(
    config.transformations.items.map((item) => item.id)
  )
  config.transformations.slots = distinctSlots(
    filterSlots(config.transformations.slots, (id) => transformationIds.has(id))
  )
  config.styling.items = deduplicate(config.styling.items)
  const stylingIds = new Set(config.styling.items.map((item) => item.id))
  config.styling.slots = distinctSlots(
    filterSlots(config.styling.slots, (id) => stylingIds.has(id))
  )
  const commands = new Set(config.commands.map((command) => command.id))
  config.launcherPages = deduplicate(config.launcherPages)
  const pageIds = new Set(config.launcherPages.map((page) => page.id))
  config.mainActions = filterSlots(config.mainActions, (slot) => {
    if (slot.type === 'command') return commands.has(slot.commandId)
    if (slot.type === 'transformation')
      return transformationIds.has(slot.transformationId)
    if (slot.type === 'styling') return stylingIds.has(slot.stylingId)
    if (slot.type === 'launcherPage') return pageIds.has(slot.pageId)
    return true
  })
  for (const page of config.launcherPages)
    page.slots = filterSlots(page.slots, (id) => commands.has(id))
  // a device refers to the pages it has shortcuts for; one gone is dropped
  config.hotkeys.launcherPages = Object.fromEntries(
    Object.entries(config.hotkeys.launcherPages).filter(([id]) =>
      pageIds.has(id)
    )
  )
  return config
}

const isDeviceSchema = (shape: Schema | undefined) =>
  shape?.['x-scope'] === 'device'

/**
 * Whether the field at `path`, e.g. `appearance.uiScalePercent`, belongs to
 * this device: it lives in the device file and is not synced with the user data
 * folder
 */
export function isDeviceScopedPath(path: string): boolean {
  let shape: Schema | undefined = schema
  for (const key of path.split('.')) {
    shape = shape?.properties?.[key]
    if (!shape) return false
    if (isDeviceSchema(shape)) return true
  }
  return false
}

/** A path of an unknown field, its keys in order */
export type ConfigPath = readonly string[]

const pathKey = (path: ConfigPath) => JSON.stringify(path)

/**
 * The config split into the part of the user, synced, and the part of this
 * device (`x-scope: device` of the schema). An unknown field goes where it came
 * from: `deviceUnknownPaths` names those read from the device file
 */
export function splitUserConfig(
  config: Record<string, unknown>,
  deviceUnknownPaths: readonly ConfigPath[] = []
): { user: Record<string, unknown>; device: Record<string, unknown> } {
  const fromDevice = new Set(deviceUnknownPaths.map(pathKey))
  const split = (
    value: Record<string, unknown>,
    shape: Schema,
    path: string[]
  ): { user: Record<string, unknown>; device: Record<string, unknown> } => {
    const user: Record<string, unknown> = {}
    const device: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const child = shape.properties?.[key]
      const childPath = [...path, key]
      if (isDeviceSchema(child)) device[key] = item
      else if (child?.properties && isRecord(item)) {
        const parts = split(item, child, childPath)
        user[key] = parts.user
        if (Object.keys(parts.device).length) device[key] = parts.device
      } else if (!child && fromDevice.has(pathKey(childPath)))
        device[key] = item
      else user[key] = item
    }
    return { user, device }
  }
  return split(config, schema, [])
}

/**
 * The config of the user and the device joined into one, and the paths of the
 * unknown fields that came from the device, for `splitUserConfig`
 */
export function joinUserConfig(
  user: Record<string, unknown>,
  device: Record<string, unknown>
): { config: Record<string, unknown>; deviceUnknownPaths: string[][] } {
  const deviceUnknownPaths: string[][] = []
  const join = (
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    shape: Schema | undefined,
    path: string[]
  ) => {
    for (const [key, item] of Object.entries(source)) {
      const child = shape?.properties?.[key]
      const childPath = [...path, key]
      if (shape && !child && !isDeviceSchema(shape))
        deviceUnknownPaths.push(childPath)
      if (
        child?.properties &&
        !isDeviceSchema(child) &&
        isRecord(item) &&
        isRecord(target[key])
      ) {
        const nested = { ...(target[key] as Record<string, unknown>) }
        join(nested, item, child, childPath)
        target[key] = nested
      } else target[key] = item
    }
  }
  const config = { ...user }
  join(config, device, schema, [])
  return { config, deviceUnknownPaths }
}

/** Whether `x-scope` marks a field inside a list item or a map entry */
export function deviceScopeInsideEntities(shape: Schema = schema): string[] {
  const found: string[] = []
  const visit = (node: unknown, path: string, isInEntity: boolean) => {
    if (!isRecord(node)) return
    if (isInEntity && node['x-scope'] !== undefined) found.push(path)
    for (const [key, child] of Object.entries(node)) {
      const entity =
        isInEntity ||
        key === 'items' ||
        key === 'additionalProperties' ||
        key === '$defs'
      if (isRecord(child)) visit(child, `${path}/${key}`, entity)
      else if (Array.isArray(child))
        child.forEach((item, index) =>
          visit(item, `${path}/${key}/${index}`, entity)
        )
    }
  }
  visit(shape, '', false)
  return found
}
