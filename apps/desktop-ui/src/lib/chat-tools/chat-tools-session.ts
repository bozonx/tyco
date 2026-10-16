import { DEFAULT_TOOL_STEP_COUNT, type ProfileToolSettings } from '@tyco/shared'

import type { AiChatTools } from '../llm/llm-request'
import { createChatToolApprovals } from './chat-tool-approvals'
import { createChatToolPolicy } from './chat-tool-policy'
import {
  createChatToolRegistry,
  type ChatToolProvider,
} from './chat-tool-registry'
import { withDebugToolGroup } from './debug-chat-tools'

export interface ChatToolsSessionDependencies {
  providers: () => readonly ChatToolProvider[]
  /** Offers the debug tools to every chat of a development build */
  isDebugEnabled?: () => boolean
  warn?: (message: string) => void
}

/** What a turn is asked for tools with */
export interface ChatToolsRequest {
  /** Null for "Ask AI" */
  profileId: string | null
  modelId: string
  /** Whether the model can call tools at all */
  canUseTools: boolean
  /** The profile's settings; "Ask AI" has none, and so no tools */
  settings: ProfileToolSettings | undefined
}

/**
 * The tools of one chat: which a turn may use, the permissions the user gave in
 * this conversation, and the calls waiting for the user
 */
export function createChatToolsSession(deps: ChatToolsSessionDependencies) {
  const policy = createChatToolPolicy({ canAsk: true })
  const approvals = createChatToolApprovals()
  const registry = createChatToolRegistry({
    providers: deps.providers,
    policy,
    warn: deps.warn,
  })

  /** The tools for a turn; undefined for a turn without any */
  const toolsFor = async (
    request: ChatToolsRequest
  ): Promise<AiChatTools | undefined> => {
    if (!request.canUseTools) return undefined
    const settings = deps.isDebugEnabled?.()
      ? withDebugToolGroup(request.settings)
      : request.settings
    const tools = await registry.resolve({
      profileId: request.profileId,
      modelId: request.modelId,
      settings,
    })
    if (!tools) return undefined
    return {
      tools,
      maxStepCount: settings?.maxStepCount ?? DEFAULT_TOOL_STEP_COUNT,
      policy,
      requestApproval: approvals.request,
    }
  }

  /**
   * Whether a turn may get any tools, decided without asking the providers:
   * enough to keep part of the context for the steps
   */
  const mayOfferTools = (
    request: Pick<ChatToolsRequest, 'canUseTools' | 'settings'>
  ) =>
    request.canUseTools &&
    (deps.isDebugEnabled?.() === true ||
      Object.values(request.settings?.groups ?? {}).some(
        (group) => group.isEnabled && group.access !== 'deny'
      ))

  return {
    toolsFor,
    mayOfferTools,
    /** The calls waiting for the user, oldest first */
    pendingApprovals: approvals.pending,
    answerApproval: approvals.answer,
    /** A new conversation starts without the permissions of the last one */
    resetPermissions: policy.reset,
    dispose: approvals.cancelAll,
  }
}

export type ChatToolsSession = ReturnType<typeof createChatToolsSession>
