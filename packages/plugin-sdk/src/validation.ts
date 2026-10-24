import {
  MAX_CONFIG_FIELDS,
  MAX_ICON_BODY_BYTES,
  MAX_ICON_DIMENSION,
  MAX_ICONS,
  RESERVED_PLUGIN_ID,
  hasPluginIdFormat,
} from './package-format.js'
import { validateSettingsMigrations } from './settings-migrations.js'
import { isRecord as record } from './value-guards.js'
import {
  PLUGIN_API_VERSION,
  type PluginDefinition,
  type PluginManifest,
  type PluginMessages,
} from './plugin.js'

export const PLUGIN_PACKAGE_FORMAT_VERSION = 1
function fail(message: string): never {
  throw new Error(message)
}

export const SUPPORTED_PLUGIN_LOCALES = [
  'en-US',
  'ru-RU',
  'de-DE',
  'fr-FR',
  'es',
  'it-IT',
  'pt-BR',
  'pl-PL',
  'tr-TR',
  'uk-UA',
  'cs-CZ',
  'hu-HU',
  'ro-RO',
  'el-GR',
  'hr-HR',
  'ka-GE',
  'kk-KZ',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
] as const

/** Requires identical dictionary structure and interpolation arguments. */
export function validatePluginLocales(
  value: unknown
): asserts value is Record<string, PluginMessages> {
  if (!record(value)) fail('Invalid plugin locales')
  const signature = (dictionary: unknown, depth = 0): unknown => {
    if (!record(dictionary) || depth > 16) fail('Invalid plugin dictionary')
    return Object.keys(dictionary)
      .sort()
      .map((key) => {
        if (
          !/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) ||
          ['__proto__', 'constructor', 'prototype'].includes(key)
        )
          fail('Invalid plugin dictionary key')
        const entry = dictionary[key]
        return [
          key,
          typeof entry === 'string'
            ? [
                'string',
                [
                  ...new Set(
                    Array.from(
                      entry.matchAll(/\{([\w]+)\}/g),
                      (match) => match[1]
                    )
                  ),
                ].sort(),
              ]
            : signature(entry, depth + 1),
        ]
      })
  }
  for (const locale of SUPPORTED_PLUGIN_LOCALES) {
    if (!record(value[locale])) fail(`Missing plugin locale: ${locale}`)
  }
  const expected = JSON.stringify(signature(value['en-US']))
  for (const [locale, dictionary] of Object.entries(value)) {
    if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)) fail('Invalid plugin locale')
    if (JSON.stringify(signature(dictionary)) !== expected)
      fail(`Plugin locale structure or placeholders differ: ${locale}`)
  }
}

/** Validates data before it reaches settings, dictionaries or registries. */
export function validatePluginManifest(
  value: unknown
): asserts value is PluginManifest {
  if (!record(value)) fail('Invalid plugin manifest')
  const allowed = new Set([
    'id',
    'version',
    'apiVersion',
    'capabilities',
    'label',
    'labelKey',
    'description',
    'descriptionKey',
    'notesDirectoryField',
    'defaultLocale',
    'locales',
    'icons',
    'defaultConfig',
  ])
  if (Object.keys(value).some((key) => !allowed.has(key)))
    fail('Unknown plugin manifest field')
  if (
    typeof value.id !== 'string' ||
    !hasPluginIdFormat(value.id) ||
    value.id === RESERVED_PLUGIN_ID
  )
    fail('Invalid plugin ID')
  if (
    typeof value.version !== 'string' ||
    !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(
      value.version
    )
  )
    fail('Invalid plugin version')
  if (value.apiVersion !== PLUGIN_API_VERSION)
    fail('Unsupported plugin API version')
  if (
    !Array.isArray(value.capabilities) ||
    new Set(value.capabilities).size !== value.capabilities.length ||
    value.capabilities.some(
      (item) => !['editor', 'browser', 'notes'].includes(item)
    )
  )
    fail('Invalid plugin capabilities')
  for (const key of ['label', 'labelKey', 'description', 'descriptionKey'])
    if (value[key] !== undefined && typeof value[key] !== 'string')
      fail('Invalid plugin text')
  if (
    typeof value.defaultLocale !== 'string' ||
    !/^[a-z]{2}-[A-Z]{2}$/.test(value.defaultLocale) ||
    !record(value.locales) ||
    !record(value.locales[value.defaultLocale])
  )
    fail('Missing plugin default locale')
  validatePluginLocales(value.locales)
  if (value.defaultConfig !== undefined) {
    if (!record(value.defaultConfig)) fail('Invalid plugin config')
    validatePluginFields(value.defaultConfig.fields)
    validateSettingsMigrations(
      value.defaultConfig,
      (value.capabilities as string[]).includes('notes')
        ? String(value.notesDirectoryField ?? 'pathToNotes')
        : undefined
    )
    if (value.defaultConfig.presets !== undefined) {
      if (!record(value.defaultConfig.presets)) fail('Invalid plugin presets')
      const fields = new Map(
        (value.defaultConfig.fields as Array<Record<string, unknown>>).map(
          (field) => [String(field.name), field]
        )
      )
      for (const [selector, presets] of Object.entries(
        value.defaultConfig.presets
      )) {
        const selectorField = fields.get(selector)
        if (
          !selectorField ||
          selectorField.type !== 'select' ||
          !record(presets)
        )
          fail('Invalid plugin preset selector')
        const options = selectorField.options as Array<{ id: string | number }>
        for (const [preset, values] of Object.entries(presets)) {
          if (
            !options.some((option) => String(option.id) === preset) ||
            !record(values)
          )
            fail('Invalid plugin preset')
          for (const [name, entry] of Object.entries(values)) {
            const field = fields.get(name)
            if (
              !field ||
              ['__proto__', 'constructor', 'prototype'].includes(name) ||
              !validPresetValue(field, entry)
            )
              fail('Invalid plugin preset value')
          }
        }
      }
    }
  }
  if (
    value.notesDirectoryField !== undefined &&
    !value.capabilities.includes('notes')
  )
    fail('Invalid notes directory field')
  if (value.capabilities.includes('notes')) {
    const fieldName = value.notesDirectoryField ?? 'pathToNotes'
    const config = value.defaultConfig as
      | {
          fields?: Array<{
            name: string
            type: string
            defaultValue?: unknown
            value?: unknown
          }>
          presets?: Record<string, Record<string, Record<string, unknown>>>
        }
      | undefined
    if (
      typeof fieldName !== 'string' ||
      !config?.fields?.some(
        (field) =>
          field.name === fieldName &&
          field.type === 'text' &&
          field.defaultValue === '' &&
          (field.value === undefined || field.value === '')
      )
    )
      fail('Notes access requires an empty directory setting')
    for (const presets of Object.values(config?.presets ?? {}))
      for (const preset of Object.values(presets))
        if (preset[fieldName] !== undefined && preset[fieldName] !== '')
          fail('Plugin presets cannot grant notes access')
  }
  if (value.icons !== undefined) {
    if (
      !record(value.icons) ||
      typeof value.icons.prefix !== 'string' ||
      !/^[a-z][a-z0-9-]*$/.test(value.icons.prefix) ||
      !record(value.icons.icons) ||
      Object.keys(value.icons.icons).length > MAX_ICONS
    )
      fail('Invalid plugin icons')
    for (const [name, icon] of Object.entries(value.icons.icons)) {
      if (
        !/^[a-z0-9-]+$/.test(name) ||
        !record(icon) ||
        typeof icon.body !== 'string' ||
        new TextEncoder().encode(icon.body).length > MAX_ICON_BODY_BYTES
      )
        fail('Invalid plugin icon')
      for (const dimension of [
        value.icons.width,
        value.icons.height,
        icon.width,
        icon.height,
      ])
        if (
          dimension !== undefined &&
          (typeof dimension !== 'number' ||
            !Number.isFinite(dimension) ||
            dimension <= 0 ||
            dimension > MAX_ICON_DIMENSION)
        )
          fail('Invalid plugin icon dimensions')
      // SVG inserted by the host must not contain active or external content.
      if (
        /<\s*(script|foreignObject|iframe|image|style|a)\b|\bon[a-z0-9_-]+\s*=|(?:href|url)\s*[=(]|javascript:|https?:|data:/i.test(
          icon.body
        )
      )
        fail('Unsafe plugin icon')
    }
  }
}

export function validatePluginFields(fields: unknown): void {
  if (!Array.isArray(fields) || fields.length > MAX_CONFIG_FIELDS)
    fail('Invalid plugin fields')
  const names = new Set<string>()
  for (const field of fields) {
    if (
      !record(field) ||
      typeof field.name !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(field.name) ||
      ['constructor', 'prototype'].includes(field.name) ||
      names.has(field.name)
    )
      fail('Invalid plugin field name')
    names.add(field.name)
    if (
      ![
        'text',
        'textarea',
        'select',
        'checkbox',
        'sortable-checklist',
      ].includes(String(field.type))
    )
      fail('Invalid plugin field type')
    if (
      field.options !== undefined &&
      (!Array.isArray(field.options) ||
        field.options.some(
          (option) =>
            !record(option) ||
            !(typeof option.id === 'string' || Number.isSafeInteger(option.id))
        ))
    )
      fail('Invalid plugin field options')
    if (
      Array.isArray(field.options) &&
      new Set(field.options.map((option) => option.id)).size !==
        field.options.length
    )
      fail('Duplicate plugin field option')
    for (const key of ['value', 'defaultValue']) {
      if (
        field[key] !== undefined &&
        !validDeclaredFieldValue(field, field[key])
      )
        fail(`Invalid plugin field ${key}`)
    }
    if (field.type === 'checkbox' && typeof field.defaultValue !== 'boolean')
      fail('Invalid checkbox default')
    if (
      field.type === 'select' &&
      (!Array.isArray(field.options) ||
        !field.options.some((option) => option.id === field.defaultValue))
    )
      fail('Invalid select default')
  }
}

function validDeclaredFieldValue(
  field: Record<string, unknown>,
  value: unknown
): boolean {
  if (field.type === 'text')
    return (
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
  if (field.type === 'textarea') return typeof value === 'string'
  if (field.type === 'sortable-checklist')
    return (
      Array.isArray(value) &&
      value.every(
        (item) =>
          record(item) &&
          typeof item.id === 'string' &&
          typeof item.enabled === 'boolean'
      )
    )
  return validPresetValue(field, value)
}

function validPresetValue(
  field: Record<string, unknown>,
  value: unknown
): boolean {
  if (field.type === 'checkbox') return typeof value === 'boolean'
  if (field.type === 'textarea') return typeof value === 'string'
  if (field.type === 'select')
    return (
      Array.isArray(field.options) &&
      field.options.some((option) => record(option) && option.id === value)
    )
  if (field.type === 'sortable-checklist')
    return validDeclaredFieldValue(field, value)
  return (
    typeof value === 'string' ||
    (typeof field.defaultValue === 'number' &&
      typeof value === 'number' &&
      Number.isFinite(value))
  )
}

/** Extracts only declarative, JSON-serializable package metadata. */
export function pluginManifest(definition: PluginDefinition): PluginManifest {
  const {
    id,
    version,
    apiVersion,
    capabilities,
    label,
    labelKey,
    description,
    descriptionKey,
    notesDirectoryField,
    defaultLocale,
    locales,
    icons,
    defaultConfig,
  } = definition
  const manifest = {
    id,
    version,
    apiVersion,
    capabilities,
    label,
    labelKey,
    description,
    descriptionKey,
    notesDirectoryField,
    defaultLocale,
    locales,
    icons,
    defaultConfig,
  }
  const copy: unknown = JSON.parse(JSON.stringify(manifest))
  validatePluginManifest(copy)
  return copy
}
