import { PLUGIN_API_VERSION, type PluginDefinition, type PluginManifest } from './plugin.js'

export const PLUGIN_PACKAGE_FORMAT_VERSION = 1
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
function fail(message: string): never { throw new Error(message) }

/** Validates data before it reaches settings, dictionaries or registries. */
export function validatePluginManifest(value: unknown): asserts value is PluginManifest {
  if (!record(value)) fail('Invalid plugin manifest')
  const allowed = new Set(['id', 'version', 'apiVersion', 'capabilities', 'label', 'labelKey', 'description', 'descriptionKey', 'defaultLocale', 'locales', 'icons', 'defaultConfig'])
  if (Object.keys(value).some((key) => !allowed.has(key))) fail('Unknown plugin manifest field')
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,127}$/.test(value.id) || value.id === 'core') fail('Invalid plugin ID')
  if (typeof value.version !== 'string' || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value.version)) fail('Invalid plugin version')
  if (value.apiVersion !== PLUGIN_API_VERSION) fail('Unsupported plugin API version')
  if (!Array.isArray(value.capabilities) || new Set(value.capabilities).size !== value.capabilities.length || value.capabilities.some((item) => !['editor', 'browser', 'notes'].includes(item))) fail('Invalid plugin capabilities')
  for (const key of ['label', 'labelKey', 'description', 'descriptionKey']) if (value[key] !== undefined && typeof value[key] !== 'string') fail('Invalid plugin text')
  if (typeof value.defaultLocale !== 'string' || !/^[a-z]{2}_[A-Z]{2}$/.test(value.defaultLocale) || !record(value.locales) || !record(value.locales[value.defaultLocale])) fail('Missing plugin fallback locale')
  function messages(dictionary: unknown, depth = 0): void {
    if (!record(dictionary) || depth > 16) fail('Invalid plugin dictionary')
    for (const [key, entry] of Object.entries(dictionary)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('Invalid plugin dictionary key')
      if (typeof entry !== 'string') messages(entry, depth + 1)
    }
  }
  for (const [locale, dictionary] of Object.entries(value.locales)) {
    if (!/^[a-z]{2}_[A-Z]{2}$/.test(locale)) fail('Invalid plugin locale')
    messages(dictionary)
  }
  if (value.defaultConfig !== undefined) {
    if (!record(value.defaultConfig)) fail('Invalid plugin config')
    validatePluginFields(value.defaultConfig.fields)
  }
  if (value.icons !== undefined) {
    if (!record(value.icons) || typeof value.icons.prefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value.icons.prefix) || !record(value.icons.icons)) fail('Invalid plugin icons')
    for (const [name, icon] of Object.entries(value.icons.icons)) {
      if (!/^[a-z0-9-]+$/.test(name) || !record(icon) || typeof icon.body !== 'string') fail('Invalid plugin icon')
      // SVG inserted by the host must not contain active or external content.
      if (/<\s*(script|foreignObject|iframe|image|style|a)\b|\bon[a-z]+\s*=|(?:href|url)\s*[=(]|javascript:|https?:/i.test(icon.body)) fail('Unsafe plugin icon')
    }
  }
}

export function validatePluginFields(fields: unknown): void {
  if (!Array.isArray(fields) || fields.length > 256) fail('Invalid plugin fields')
  const names = new Set<string>()
  for (const field of fields) {
    if (!record(field) || typeof field.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(field.name) || ['enabled', 'constructor', 'prototype'].includes(field.name) || names.has(field.name)) fail('Invalid plugin field name')
    names.add(field.name)
    if (!['text', 'textarea', 'select', 'checkbox', 'sortable-checklist'].includes(String(field.type))) fail('Invalid plugin field type')
    if (field.options !== undefined && (!Array.isArray(field.options) || field.options.some((option) => !record(option) || !['string', 'number'].includes(typeof option.id)))) fail('Invalid plugin field options')
    if (field.type === 'checkbox' && typeof field.defaultValue !== 'boolean') fail('Invalid checkbox default')
    if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.some((option) => option.id === field.defaultValue))) fail('Invalid select default')
  }
}

/** Extracts only declarative, JSON-serializable package metadata. */
export function pluginManifest(definition: PluginDefinition): PluginManifest {
  const { id, version, apiVersion, capabilities, label, labelKey, description, descriptionKey, defaultLocale, locales, icons, defaultConfig } = definition
  const manifest = { id, version, apiVersion, capabilities, label, labelKey, description, descriptionKey, defaultLocale, locales, icons, defaultConfig }
  const copy: unknown = JSON.parse(JSON.stringify(manifest))
  validatePluginManifest(copy)
  return copy
}
