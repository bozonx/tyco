import type { ProjectAccessMode } from '@tyco/shared'

/** What a tool call needs before it runs, in the terms of the AI SDK */
export type ChatToolApprovalStatus = 'approved' | 'denied' | 'user-approval'

/**
 * The user's answer to a call that asked: once, for the rest of the chat, for
 * good in the profile, or no
 */
export type ChatToolDecision =
  'allow-once' | 'allow-session' | 'allow-always' | 'deny'

/** What the user may answer a call with: its decision, or allowing its batch */
export type ChatToolAnswer = ChatToolDecision | 'allow-batch'

export interface ChatToolPolicyOptions {
  /**
   * Whether somebody can answer an `ask`: false for a chat run through the
   * external API, where `ask` means `deny`
   */
  canAsk: boolean
  /** Told when what the chat keeps of its permissions changes */
  onPermissionsChange?: (state: ChatToolPermissionsState) => void
}

/** What a chat keeps of its permissions, to give them back when reopened */
export interface ChatToolPermissionsState {
  /** The approval keys allowed for the chat */
  allowed: string[]
  /** The targets allowed to receive data once it held personal data */
  leakAllowed: string[]
}

const ACCESS_ORDER: readonly ProjectAccessMode[] = ['allow', 'ask', 'deny']

/** The stricter of the access modes */
export function stricterAccess(
  ...modes: ProjectAccessMode[]
): ProjectAccessMode {
  return modes.reduce<ProjectAccessMode>(
    (strictest, mode) =>
      ACCESS_ORDER.indexOf(mode) > ACCESS_ORDER.indexOf(strictest)
        ? mode
        : strictest,
    'allow'
  )
}

/** Whether `mode` is stricter than `than` */
export const isStricterAccess = (
  mode: ProjectAccessMode,
  than: ProjectAccessMode
) => ACCESS_ORDER.indexOf(mode) > ACCESS_ORDER.indexOf(than)

/**
 * What a permission "for this chat" is given to: a tool, or a tool within one
 * scope of it, e.g. writing to one project, so that allowing it there does not
 * allow it everywhere
 */
export function chatToolApprovalKey(toolName: string, scope?: string) {
  return scope ? `${toolName}:${scope}` : toolName
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi

/** A URL as it is compared: without a trailing slash or fragment */
const normalizedUrl = (url: string) => {
  try {
    const parsed = new URL(url.replace(/[.,;:!?]+$/, ''))
    parsed.hash = ''
    return parsed.href.replace(/\/$/, '')
  } catch {
    return undefined
  }
}

/**
 * Decides whether a tool call runs, asks, or is refused, and keeps what the
 * chat learned: the tools the user allowed for it, whether it holds personal
 * data, and the URLs it named, see "leak protection" in
 * `dev_docs/architecture.md`
 */
export function createChatToolPolicy(options: ChatToolPolicyOptions) {
  const sessionAllowed = new Set<string>()
  const leakAllowed = new Set<string>()
  const knownUrls = new Set<string>()
  let hasPersonalData = false

  /**
   * @param approvalKey The tool and the scope of the call, from
   *   `chatToolApprovalKey`
   * @param access The access of the call: the tool's policy, narrowed by the
   *   call itself when the tool knows better, e.g. by the project of a path
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

  /**
   * Applies the user's answer; true when the call may run. A call that asked
   * about a leak target allows the target for the chat whatever the answer
   */
  const answer = (
    approvalKey: string,
    decision: ChatToolDecision,
    leakTarget?: string
  ) => {
    if (decision === 'deny') return false
    if (leakTarget) leakAllowed.add(leakTarget)
    else if (decision === 'allow-session') sessionAllowed.add(approvalKey)
    else return true
    options.onPermissionsChange?.(exportPermissions())
    return true
  }

  const exportPermissions = (): ChatToolPermissionsState => ({
    allowed: [...sessionAllowed],
    leakAllowed: [...leakAllowed],
  })

  const noteKnownText = (text: string | undefined) => {
    for (const match of text?.match(URL_PATTERN) ?? []) {
      const url = normalizedUrl(match)
      if (url) knownUrls.add(url)
    }
  }

  return {
    decide,
    answer,
    isAllowedForSession: (approvalKey: string) =>
      sessionAllowed.has(approvalKey),
    /** The conversation now holds the user's files, memory or attachments */
    notePersonalData: () => {
      hasPersonalData = true
    },
    hasPersonalData: () => hasPersonalData,
    /** Remembers the URLs a text names: the user's messages, search results */
    noteKnownText,
    isKnownUrl: (url: string) => {
      const normalized = normalizedUrl(url)
      return normalized !== undefined && knownUrls.has(normalized)
    },
    isLeakAllowed: (target: string) => leakAllowed.has(target),
    /** What the chat keeps of its permissions */
    exportPermissions,
    /** Gives a reopened chat back its permissions, and only them */
    restorePermissions: (
      state: Partial<ChatToolPermissionsState> | undefined
    ) => {
      sessionAllowed.clear()
      leakAllowed.clear()
      for (const key of state?.allowed ?? []) sessionAllowed.add(key)
      for (const key of state?.leakAllowed ?? []) leakAllowed.add(key)
    },
    /** Forgets what the chat learned, e.g. for a new conversation */
    reset: () => {
      sessionAllowed.clear()
      leakAllowed.clear()
      knownUrls.clear()
      hasPersonalData = false
    },
  }
}

export type ChatToolPolicy = ReturnType<typeof createChatToolPolicy>
