import type { AiAttachedFile, ProfileMemoryMode } from '@tyco/shared'

import type { AiChatTools } from '../llm/llm-request'
import { createChatToolApprovals } from './chat-tool-approvals'
import {
  createChatToolPolicy,
  type ChatToolDecision,
  type ChatToolPermissionsState,
} from './chat-tool-policy'
import {
  createChatToolRegistry,
  type ChatToolAlwaysAllowTarget,
  type ChatToolProvider,
} from './chat-tool-registry'
import { toolCallContextOf, type ToolScope } from './tool-catalog'

export interface ChatToolsSessionDependencies {
  providers: () => readonly ChatToolProvider[]
  /** Model steps one answer may take, see `llm.maxToolSteps` */
  getMaxStepCount: () => number
  /**
   * Writes "always allow" into the profile; the call runs once it is saved,
   * since Rust reads the profile for every call
   */
  alwaysAllow?: (target: ChatToolAlwaysAllowTarget) => Promise<void>
  /** Told when the permissions "in this chat" change, to keep them with it */
  onPermissionsChange?: (state: ChatToolPermissionsState) => void
  warn?: (message: string) => void
}

/** What a turn is asked for tools with */
export interface ChatToolsRequest {
  /** Null outside a profile chat */
  profileId: string | null
  modelId: string
  /** Whether the model can call tools at all */
  canUseTools: boolean
  /** Where the tools are offered, see `ToolScope` */
  scope: ToolScope
  /** The profile's long-term memory mode */
  memoryMode?: ProfileMemoryMode
  /** How much the outputs of the turn's tools may add to the request */
  outputBudgetCharacters?: number
  /** The originals attached to the conversation, for the file tools */
  attachedFiles?: readonly AiAttachedFile[]
  /** What the user wrote: the URLs it names may be read without asking */
  conversationText?: string
}

/**
 * The tools of one chat: which a turn may use, the permissions the user gave in
 * this conversation, and the calls waiting for the user
 */
export function createChatToolsSession(deps: ChatToolsSessionDependencies) {
  const policy = createChatToolPolicy({
    canAsk: true,
    onPermissionsChange: deps.onPermissionsChange,
  })
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
    policy.noteKnownText(request.conversationText)
    // the memory is in the instructions of a profile chat, and attachments
    // are the user's own: from the start the chat holds personal data
    if (
      request.scope.kind === 'profile' &&
      ((request.memoryMode ?? 'auto') !== 'off' ||
        Boolean(request.attachedFiles?.length))
    )
      policy.notePersonalData()
    const tools = await registry.resolve({
      profileId: request.scope.kind === 'profile' ? request.profileId : null,
      modelId: request.modelId,
      scope: request.scope,
      callContext: toolCallContextOf(request.scope),
      memoryMode: request.memoryMode,
      outputBudgetCharacters: request.outputBudgetCharacters,
      attachedFiles: request.attachedFiles,
    })
    if (!tools) return undefined
    return {
      tools,
      maxStepCount: deps.getMaxStepCount(),
      policy,
      // the user decides on what the call would change, when the tool can tell
      requestApproval: async (approval, signal) => {
        const preview = await tools.definitions
          .get(approval.toolName)
          ?.preview?.(approval.input, signal)
          .catch(() => undefined)
        // "always allow" only where it can be saved
        const { alwaysAllow, ...rest } = approval
        const shown = {
          ...rest,
          ...(alwaysAllow && deps.alwaysAllow ? { alwaysAllow } : {}),
          ...(preview ? { preview } : {}),
        }
        const decision = await approvals.request(shown, signal)
        return decision === 'allow-always'
          ? persistAlwaysAllow(approval.alwaysAllow)
          : decision
      },
    }
  }

  /** Saves "always allow"; a failure still lets the call run this once */
  const persistAlwaysAllow = async (
    target: ChatToolAlwaysAllowTarget | undefined
  ): Promise<ChatToolDecision> => {
    if (!target || !deps.alwaysAllow) return 'allow-once'
    try {
      await deps.alwaysAllow(target)
    } catch (error) {
      deps.warn?.(`Could not save the permission: ${String(error)}`)
    }
    return 'allow-once'
  }

  /**
   * Whether a turn may get any tools, decided without asking the providers:
   * enough to keep part of the context for the steps. Reply blocks are always
   * offered, so any model that calls tools gets some
   */
  const mayOfferTools = (request: Pick<ChatToolsRequest, 'canUseTools'>) =>
    request.canUseTools

  return {
    toolsFor,
    mayOfferTools,
    /** The calls waiting for the user, oldest first */
    pendingApprovals: approvals.pending,
    answerApproval: approvals.answer,
    /** Answers every call of a batch that still waits */
    answerApprovalBatch: approvals.answerBatch,
    /** A new conversation starts without the permissions of the last one */
    resetPermissions: policy.reset,
    /** What the chat keeps of its permissions, saved with it */
    exportPermissions: policy.exportPermissions,
    /** Gives a reopened chat its permissions back */
    restorePermissions: policy.restorePermissions,
    dispose: approvals.cancelAll,
  }
}
