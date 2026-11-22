import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import type { PluginChatToolsDependencies } from '../lib/chat-tools/plugin-chat-tools'
import { builtinPluginIds } from '../lib/plugins/builtin-plugins'
import type { HostPluginChatTool } from '../lib/plugins/plugin-context'

/** The chat tools the running plugins registered */
export const usePluginChatToolsStore = defineStore('pluginChatTools', () => {
  const tools = shallowRef<readonly HostPluginChatTool[]>([])

  const register = (items: readonly HostPluginChatTool[]) => {
    tools.value = [...tools.value, ...items]
    return () => {
      tools.value = tools.value.filter((tool) => !items.includes(tool))
    }
  }

  const builtin = new Set(builtinPluginIds)
  /** What the chat tools and the settings read the plugin tools by */
  const dependencies: PluginChatToolsDependencies = {
    tools: () => tools.value,
    isBuiltin: (pluginId) => builtin.has(pluginId),
  }

  return { tools, register, dependencies }
})
