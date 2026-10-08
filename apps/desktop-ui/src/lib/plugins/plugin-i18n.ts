import { addCollection } from '@iconify/vue'
import type { PluginDefinition, PluginMessages } from '@tyco/plugin-sdk'

import { i18n } from '../i18n'
import { messages } from '../i18n/messages'
import { createPluginResources } from './plugin-resources'

const resources = createPluginResources(
  {
    setMessages: (locale, namespace, value) => {
      const current = i18n.global.getLocaleMessage(
        locale as keyof typeof messages
      ) as Record<string, unknown>
      const id = namespace.split('.')[1]
      i18n.global.setLocaleMessage(
        locale as keyof typeof messages,
        {
          ...current,
          plugins: { ...(current.plugins as object), [id]: value },
        } as never
      )
    },
    removeMessages: (locale, namespace) => {
      const current = i18n.global.getLocaleMessage(
        locale as keyof typeof messages
      ) as Record<string, unknown>
      const plugins = { ...(current.plugins as Record<string, PluginMessages>) }
      delete plugins[namespace.split('.')[1]]
      i18n.global.setLocaleMessage(
        locale as keyof typeof messages,
        { ...current, plugins } as never
      )
    },
    addIcons: (icons) => {
      addCollection(icons)
    },
  },
  Object.keys(messages)
)

export function registerPluginResources(
  id: string,
  plugin: Partial<PluginDefinition>
) {
  resources.register(id, plugin.locales, plugin.defaultLocale, plugin.icons)
}
export const removePluginResources = resources.remove
