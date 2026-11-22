import { computed } from 'vue'

import { pluginCatalogEntries } from '../lib/chat-tools/plugin-chat-tools'
import { usePluginChatToolsStore } from '../stores/plugin-chat-tools'

/** The plugins with chat tools, as the settings list them */
export function usePluginToolSources() {
  const store = usePluginChatToolsStore()
  return computed(() => {
    void store.tools
    return pluginCatalogEntries(store.dependencies)
  })
}
