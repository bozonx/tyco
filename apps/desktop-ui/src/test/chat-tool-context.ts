import type { ProfileToolSettings, ToolRef } from '@tyco/shared'

import {
  toolCallContextOf,
  type ToolScope,
} from '../lib/chat-tools/tool-catalog'

/**
 * The context fields of a tool request: a profile chat for an id, "Ask AI" for
 * null
 */
export function toolContext(
  profileId: string | null,
  settings?: ProfileToolSettings,
  options: { isWebEnabled?: boolean } = {}
) {
  const scope: ToolScope =
    profileId === null
      ? { kind: 'askAi', isWebEnabled: options.isWebEnabled ?? true }
      : { kind: 'profile', profileId, settings, catalog: undefined }
  return { profileId, scope, callContext: toolCallContextOf(scope) }
}

/** The context fields of an AI command with its whitelist */
export function aiCommandToolContext(commandId: string, tools: ToolRef[]) {
  const scope: ToolScope = {
    kind: 'aiCommand',
    commandId,
    tools,
    catalog: undefined,
  }
  return { profileId: null, scope, callContext: toolCallContextOf(scope) }
}

/** Profile tool settings from a few changes */
export const toolSettings = (
  patch: Partial<ProfileToolSettings> = {}
): ProfileToolSettings => ({ sources: {}, tools: {}, commandIds: [], ...patch })
