import type { SystemContext } from '../system-context/system-context'
import type { ChatToolProvider } from './chat-tool-registry'
import { SYSTEM_SOURCE, type CatalogTool } from './tool-catalog'

/** The tool that tells the exact time and the system the assistant runs on */
export const SYSTEM_INFO_TOOL_NAME = 'get_system_info'

export const SYSTEM_TOOL_CATALOG: readonly (CatalogTool & {
  labelKey: string
})[] = [
  {
    source: SYSTEM_SOURCE,
    name: SYSTEM_INFO_TOOL_NAME,
    labelKey: 'chatTools.system.infoLabel',
    risk: 'read',
  },
]

/**
 * Offers `get_system_info` where the scope lets it: a profile, unless it
 * switched the tool off, and an AI command that has it on its list. Never in
 * "Ask AI", see `toolStateIn`
 */
export function createSystemToolProvider(
  context: Pick<SystemContext, 'details'>
): ChatToolProvider {
  return {
    id: 'system',
    tools: () => [
      {
        name: SYSTEM_INFO_TOOL_NAME,
        source: SYSTEM_SOURCE,
        risk: 'read',
        labelKey: 'chatTools.system.infoLabel',
        icon: 'mdi:monitor-dashboard',
        description:
          'Returns the exact local time with its offset, the time zone, the operating system, the processor architecture and, on Linux, the window system and the desktop. The current date is already known from the instructions; call this only when the time of day or these details matter.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => JSON.stringify(await context.details()),
      },
    ],
  }
}
