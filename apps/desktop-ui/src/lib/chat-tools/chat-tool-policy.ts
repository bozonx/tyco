import type { ProjectAccessMode } from '@tyco/shared'

/** What a tool call needs before it runs, in the terms of the AI SDK */
export type ChatToolApprovalStatus = 'approved' | 'denied' | 'user-approval'

/** The user's answer to a call that asked */
export type ChatToolDecision = 'allow-once' | 'allow-session' | 'deny'

export interface ChatToolPolicyOptions {
  /**
   * Whether somebody can answer an `ask`: false for a chat run through the
   * external API, where `ask` means `deny`
   */
  canAsk: boolean
}

/**
 * What a permission "for this session" is given to: a tool, or a tool within
 * one scope of it, e.g. writing to one project, so that allowing it there does
 * not allow it everywhere
 */
export function chatToolApprovalKey(toolName: string, scope?: string) {
  return scope ? `${toolName}:${scope}` : toolName
}

/**
 * Decides whether a tool call runs, asks, or is refused, and remembers the
 * tools the user allowed for the rest of the session
 */
export function createChatToolPolicy(options: ChatToolPolicyOptions) {
  const sessionAllowed = new Set<string>()

  /**
   * @param approvalKey The tool and the scope of the call, from
   *   `chatToolApprovalKey`
   * @param access The access of its group, or of the call itself when the tool
   *   knows better, e.g. by the project a path is in
   */
  const decide = (
    approvalKey: string,
    access: ProjectAccessMode
  ): ChatToolApprovalStatus => {
    if (access === 'allow') return 'approved'
    if (access === 'deny') return 'denied'
    if (sessionAllowed.has(approvalKey)) return 'approved'
    return options.canAsk ? 'user-approval' : 'denied'
  }

  /** Applies the user's answer; true when the call may run */
  const answer = (approvalKey: string, decision: ChatToolDecision) => {
    if (decision === 'allow-session') sessionAllowed.add(approvalKey)
    return decision !== 'deny'
  }

  return {
    decide,
    answer,
    isAllowedForSession: (approvalKey: string) =>
      sessionAllowed.has(approvalKey),
    /** Forgets the session's permissions, e.g. for a new conversation */
    reset: () => sessionAllowed.clear(),
  }
}

export type ChatToolPolicy = ReturnType<typeof createChatToolPolicy>
