/**
 * One conversation of the quick request: its chat id, which the full chat keeps
 * when the conversation moves there, and its tools with the permissions the
 * user gave "for this session". See `dev_docs/chat-files.md`
 */
import { shallowRef } from 'vue'

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
  /** Reactive, so that the feed sees the calls waiting for the user */
  const scope = shallowRef<{ profileId: string | null; tools: Tools }>()
  let isDisposed = false

  /**
   * The tools of the conversation with the profile `profileId`. Another profile
   * starts over, without the permissions given to the last one
   */
  function toolsFor(profileId: string | null, profile?: Profile): Tools {
    if (isDisposed) throw new Error('The quick request session has ended')
    if (scope.value?.profileId === profileId) return scope.value.tools
    scope.value?.tools.dispose()
    const tools = deps.createTools({ chatId, profileId, profile })
    scope.value = { profileId, tools }
    return tools
  }

  return {
    chatId,
    toolsFor,
    /** The tools made last, if any */
    currentTools: (): Tools | undefined => scope.value?.tools,
    /** Ends the session: calls waiting for the user are cancelled */
    dispose: () => {
      isDisposed = true
      scope.value?.tools.dispose()
      scope.value = undefined
    },
  }
}

export type QuickAiRequestSession<
  Tools extends QuickAiRequestTools,
  Profile,
> = ReturnType<typeof createQuickAiRequestSession<Tools, Profile>>
