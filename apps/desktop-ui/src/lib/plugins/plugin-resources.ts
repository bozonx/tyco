import type {
  InputConfigItem,
  PluginMessages,
  PluginDefinition,
} from '@tyco/plugin-sdk'

/** IDs may contain legacy display names, but never become dictionary paths. */
export function pluginNamespace(id: string): string {
  return `plugins.p${Array.from(new TextEncoder().encode(id), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function pluginIconPrefix(id: string): string {
  return `tyco-${pluginNamespace(id).split('.')[1]}`
}
export function pluginIconName(
  id: string,
  icon?: string,
  sourcePrefix?: string
): string | undefined {
  return sourcePrefix && icon?.startsWith(`${sourcePrefix}:`)
    ? `${pluginIconPrefix(id)}:${icon.slice(sourcePrefix.length + 1)}`
    : icon
}

export function pluginMessageKey(id: string, key?: string): string | undefined {
  return key?.startsWith('local.')
    ? `${pluginNamespace(id)}.${key.slice(6)}`
    : key
}

export function scopeConfigFields(
  id: string,
  fields: InputConfigItem[] = []
): InputConfigItem[] {
  return fields.map((field) => ({
    ...field,
    labelKey: pluginMessageKey(id, field.labelKey),
    options: field.options?.map((option) => ({
      ...option,
      labelKey: pluginMessageKey(id, option.labelKey),
    })),
  }))
}

export interface PluginResourceHost {
  setMessages(locale: string, namespace: string, messages: PluginMessages): void
  removeMessages(locale: string, namespace: string): void
  addIcons?(icons: NonNullable<PluginDefinition['icons']>): void
}

function mergeMessages(
  base: PluginMessages,
  translated: PluginMessages
): PluginMessages {
  const result = { ...base }
  for (const [key, value] of Object.entries(translated)) {
    const fallback = result[key]
    result[key] =
      typeof value === 'object' &&
      value !== null &&
      typeof fallback === 'object' &&
      fallback !== null
        ? mergeMessages(fallback as PluginMessages, value as PluginMessages)
        : value
  }
  return result
}

export function createPluginResources(
  host: PluginResourceHost,
  supportedLocales: readonly string[]
) {
  const installed = new Map<string, string[]>()
  function remove(id: string) {
    for (const locale of installed.get(id) ?? [])
      host.removeMessages(locale, pluginNamespace(id))
    installed.delete(id)
  }
  function register(
    id: string,
    locales: Record<string, PluginMessages> = {},
    defaultLocale = 'en_US',
    icons?: PluginDefinition['icons']
  ) {
    remove(id)
    const fallback = locales[defaultLocale] ?? {}
    const targets = [...new Set([...supportedLocales, ...Object.keys(locales)])]
    for (const locale of targets)
      host.setMessages(
        locale,
        pluginNamespace(id),
        mergeMessages(fallback, locales[locale] ?? {})
      )
    installed.set(id, targets)
    if (icons) host.addIcons?.({ ...icons, prefix: pluginIconPrefix(id) })
  }
  return { register, remove }
}
