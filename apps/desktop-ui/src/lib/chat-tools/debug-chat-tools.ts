import type { RegisteredOperation } from '../operations/operation-types'
import type { ChatToolProvider } from './chat-tool-registry'
import { adaptRegisteredOperation } from './registered-operation-adapter'
import { DEBUG_SOURCE } from './tool-catalog'

/** Whether a development build offers the debug tools to every chat */
export function isDebugChatToolsEnabled(
  env: { DEV?: boolean; VITE_DEBUG_CHAT_TOOLS?: string } = import.meta.env
): boolean {
  return env.DEV === true && env.VITE_DEBUG_CHAT_TOOLS === 'true'
}

/** Tells the current time; it asks first, to try the approval on a real model */
export const CURRENT_TIME_TOOL = {
  id: 'get_current_time',
  label: 'Current time',
  icon: 'mdi:clock-outline',
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
} satisfies RegisteredOperation

export function createDebugChatToolProvider(): ChatToolProvider {
  return {
    id: 'debug',
    tools: async () => [
      await adaptRegisteredOperation(CURRENT_TIME_TOOL, {
        source: DEBUG_SOURCE,
        risk: 'read',
      }).then((tool) => ({ ...tool, defaultPolicy: 'ask' as const })),
    ],
  }
}
