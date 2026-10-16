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
 * Decides whether a tool call runs, asks, or is refused, and remembers the
 * tools the user allowed for the rest of the session
 */
export function createChatToolPolicy(options: ChatToolPolicyOptions) {
  const sessionAllowed = new Set<string>()

  /**
   * @param toolName The tool's name as the model calls it
   * @param access The access of its group, or of the call itself when the tool
   *   knows better, e.g. by the project a path is in
   */
  const decide = (
    toolName: string,
    access: ProjectAccessMode
  ): ChatToolApprovalStatus => {
    if (access === 'allow') return 'approved'
    if (access === 'deny') return 'denied'
    if (sessionAllowed.has(toolName)) return 'approved'
    return options.canAsk ? 'user-approval' : 'denied'
  }

  /** Applies the user's answer; true when the call may run */
  const answer = (toolName: string, decision: ChatToolDecision) => {
    if (decision === 'allow-session') sessionAllowed.add(toolName)
    return decision !== 'deny'
  }

  return {
    decide,
    answer,
    isAllowedForSession: (toolName: string) => sessionAllowed.has(toolName),
    /** Forgets the session's permissions, e.g. for a new conversation */
    reset: () => sessionAllowed.clear(),
  }
}

export type ChatToolPolicy = ReturnType<typeof createChatToolPolicy>
