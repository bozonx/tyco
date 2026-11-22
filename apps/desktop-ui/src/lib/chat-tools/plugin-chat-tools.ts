import { isRecord } from '@tyco/shared/value-guards'

import type { HostPluginChatTool } from '../plugins/plugin-context'
import type { ChatToolProvider } from './chat-tool-registry'
import { toolResultForModel } from './registered-operation-adapter'
import type { CatalogSourceEntry } from './tool-catalog-entries'
import { chatToolName } from './tool-name'

export interface PluginChatToolsDependencies {
  /** The chat tools of the plugins that run now */
  tools: () => readonly HostPluginChatTool[]
  /** Whether a plugin comes with Tyco; the others ask before each call */
  isBuiltin: (pluginId: string) => boolean
  /** The name the user knows a plugin by */
  pluginLabel?: (pluginId: string) => string | undefined
}

/**
 * The name the model calls a plugin's tool by: `<plugin>__<tool>`, shortened
 * with a hash to what the providers accept, so that it never meets the name of
 * a command or an MCP tool
 */
export const pluginChatToolName = (pluginId: string, toolId: string) =>
  chatToolName(`${pluginId}__${toolId}`)

/** The tools the plugins declare for the chat */
export function createPluginChatToolProvider(
  deps: PluginChatToolsDependencies
): ChatToolProvider {
  return {
    id: 'plugin',
    tools: () =>
      Promise.all(
        deps
          .tools()
          .map(async (tool) => ({
            name: await pluginChatToolName(tool.pluginId, tool.toolId),
            source: { kind: 'plugin' as const, id: tool.pluginId },
            catalogName: tool.toolId,
            risk: tool.risk,
            ...(deps.isBuiltin(tool.pluginId) ? {} : { isThirdParty: true }),
            capabilities: tool.capabilities,
            givesUntrustedContent: true,
            sourceLabel: deps.pluginLabel?.(tool.pluginId) ?? tool.pluginId,
            labelKey: tool.labelKey,
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: async (input, { signal }) =>
              toolResultForModel(
                await tool.run(isRecord(input) ? input : {}, signal)
              ),
          }))
      ),
  }
}

/** The plugins with chat tools, as the settings list them */
export function pluginCatalogEntries(
  deps: PluginChatToolsDependencies
): CatalogSourceEntry[] {
  const byPlugin = new Map<string, HostPluginChatTool[]>()
  for (const tool of deps.tools())
    byPlugin.set(tool.pluginId, [...(byPlugin.get(tool.pluginId) ?? []), tool])
  return [...byPlugin].map(([pluginId, tools]) => ({
    source: { kind: 'plugin', id: pluginId },
    label: deps.pluginLabel?.(pluginId) ?? pluginId,
    descriptionKey: 'toolPermissions.pluginSourceHint',
    icon: 'mdi:puzzle-outline',
    capabilities: tools[0]!.capabilities,
    ...(deps.isBuiltin(pluginId) ? {} : { isThirdParty: true }),
    tools: tools.map((tool) => ({
      source: { kind: 'plugin', id: pluginId },
      name: tool.toolId,
      labelKey: tool.labelKey,
      risk: tool.risk,
      ...(deps.isBuiltin(pluginId) ? {} : { isThirdParty: true }),
    })),
  }))
}
