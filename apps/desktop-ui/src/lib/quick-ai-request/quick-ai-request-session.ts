/**
 * One conversation of the quick request: its chat id, which the full chat keeps
 * when the conversation moves there, and its tools with the permissions the
 * user gave "for this session". See `dev_docs/chat-files.md`
 */

/** The tools of one conversation, as `createDesktopChatTools` makes them */
export interface QuickAiRequestTools {
  /** Cancels the calls waiting for the user */
  dispose: () => void
}

export interface QuickAiRequestSessionDependencies<
  Tools extends QuickAiRequestTools,
  Profile,
> {
  createId: () => string
  createTools: (scope: {
    chatId: string
    profileId: string | null
    profile?: Profile
  }) => Tools
}

export function createQuickAiRequestSession<
  Tools extends QuickAiRequestTools,
  Profile,
>(deps: QuickAiRequestSessionDependencies<Tools, Profile>) {
  const chatId = deps.createId()
  let scope: { profileId: string | null; tools: Tools } | undefined
  let isDisposed = false

  /**
   * The tools of the conversation with the profile `profileId`. Another profile
   * starts over, without the permissions given to the last one
   */
  function toolsFor(profileId: string | null, profile?: Profile): Tools {
    if (isDisposed) throw new Error('The quick request session has ended')
    if (scope?.profileId === profileId) return scope.tools
    scope?.tools.dispose()
    const tools = deps.createTools({ chatId, profileId, profile })
    scope = { profileId, tools }
    return tools
  }

  return {
    chatId,
    toolsFor,
    /** The tools made last, if any */
    currentTools: (): Tools | undefined => scope?.tools,
    /** Ends the session: calls waiting for the user are cancelled */
    dispose: () => {
      isDisposed = true
      scope?.tools.dispose()
      scope = undefined
    },
  }
}

export type QuickAiRequestSession<
  Tools extends QuickAiRequestTools,
  Profile,
> = ReturnType<typeof createQuickAiRequestSession<Tools, Profile>>
