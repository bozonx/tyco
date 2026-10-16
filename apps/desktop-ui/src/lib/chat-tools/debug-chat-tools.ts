import type { ProfileToolSettings } from '@tyco/shared'

import type { RegisteredTool } from '../tools/tool-types'
import type { ChatToolProvider } from './chat-tool-registry'
import { adaptRegisteredTool } from './registered-tool-adapter'

/** The group of the debug tools */
export const DEBUG_TOOL_GROUP_ID = 'debug'

/** Whether a development build offers the debug tools to every chat */
export function isDebugChatToolsEnabled(
  env: { DEV?: boolean; VITE_DEBUG_CHAT_TOOLS?: string } = import.meta.env
): boolean {
  return env.DEV === true && env.VITE_DEBUG_CHAT_TOOLS === 'true'
}

/** Tells the current time; it asks first, to try the approval on a real model */
export const CURRENT_TIME_TOOL: RegisteredTool = {
  id: 'get_current_time',
  label: 'Current time',
  owner: { kind: 'core' },
  description:
    'Returns the current date and time. Use it when the answer depends on the current time.',
  inputSchema: {
    type: 'object',
    properties: {
      timeZone: {
        type: 'string',
        description:
          'An IANA time zone such as "Europe/Madrid"; local time when omitted',
      },
    },
  },
  async run({ input }) {
    const timeZone =
      typeof input.timeZone === 'string' && input.timeZone
        ? input.timeZone
        : undefined
    try {
      return {
        ok: true,
        content: new Date().toLocaleString('en-US', {
          timeZone,
          dateStyle: 'full',
          timeStyle: 'long',
        }),
      }
    } catch {
      return { ok: false, message: `Unknown time zone: ${timeZone}` }
    }
  },
}

export function createDebugChatToolProvider(): ChatToolProvider {
  return {
    id: 'debug',
    tools: () => [
      adaptRegisteredTool(CURRENT_TIME_TOOL, { groupId: DEBUG_TOOL_GROUP_ID }),
    ],
  }
}

/** The settings with the debug group on, asking before each call */
export function withDebugToolGroup(
  settings: ProfileToolSettings | undefined
): ProfileToolSettings {
  return {
    ...settings,
    groups: {
      ...settings?.groups,
      [DEBUG_TOOL_GROUP_ID]: { isEnabled: true, access: 'ask' },
    },
  }
}
