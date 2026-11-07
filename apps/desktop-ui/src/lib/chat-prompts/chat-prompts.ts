import type {
  ChatPromptConfig,
  CustomActionSlotConfig,
  MainActionConfig,
  ShortcutSlots,
} from '@tyco/shared'

import { nameFromPrompt, nextNumberedId } from '../shortcut-slots/slot-prompt'

const ID_PREFIX = 'chat-prompt'

/** A profile a prompt may belong to */
export interface ChatPromptProfile {
  id: string
  name: string
}

/** A prompt as the menus show it */
export interface ChatPromptView {
  prompt: ChatPromptConfig
  /** The name of the prompt, or the start of its text when it has none */
  label: string
  /** The name of the profile of the prompt; empty for a prompt of every profile */
  profileName: string
  /** The prompt names a profile that no longer exists */
  isProfileMissing: boolean
  /**
   * The profile the prompt runs with outside a chat; `null` for the plain
   * quick AI request, as for a prompt whose profile is gone
   */
  runProfileId: string | null
}

export interface DescribeChatPromptsOptions {
  profiles: readonly ChatPromptProfile[]
  /**
   * Whether the profile list is known; until then no prompt is reported as
   * missing its profile
   */
  areProfilesLoaded: boolean
}

/** The label of a prompt: its name, or the start of its text */
export function chatPromptLabel(prompt: ChatPromptConfig): string {
  return prompt.name.trim() || nameFromPrompt(prompt.rule)
}

/** Describes one prompt; see `describeChatPrompts` */
export function describeChatPrompt(
  prompt: ChatPromptConfig,
  options: DescribeChatPromptsOptions
): ChatPromptView {
  const label = chatPromptLabel(prompt)
  if (!prompt.profileId) {
    return {
      prompt,
      label,
      profileName: '',
      isProfileMissing: false,
      runProfileId: null,
    }
  }
  const profile = options.profiles.find((item) => item.id === prompt.profileId)
  const isProfileMissing = options.areProfilesLoaded && !profile
  return {
    prompt,
    label,
    profileName: profile?.name ?? '',
    isProfileMissing,
    runProfileId: isProfileMissing ? null : prompt.profileId,
  }
}

/** The prompts that can run, the ones with a text, in list order */
export function describeChatPrompts(
  items: readonly ChatPromptConfig[] | undefined,
  options: DescribeChatPromptsOptions
): ChatPromptView[] {
  return (items ?? [])
    .filter((prompt) => prompt.rule.trim())
    .map((prompt) => describeChatPrompt(prompt, options))
}

/**
 * The prompts a chat of `profileId` offers, `null` standing for the chat
 * without a profile: the prompts of every profile, those whose profile is
 * gone, and the prompts of this profile
 */
export function chatPromptsOfProfile(
  views: readonly ChatPromptView[],
  profileId: string | null | undefined
): ChatPromptView[] {
  return views.filter(
    (view) =>
      !view.prompt.profileId ||
      view.isProfileMissing ||
      view.prompt.profileId === (profileId ?? '')
  )
}

/** The prompts whose name, text or profile name has `query`, ignoring case */
export function filterChatPrompts(
  views: readonly ChatPromptView[],
  query: string
): ChatPromptView[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...views]
  return views.filter((view) =>
    [view.label, view.prompt.rule, view.profileName].some((text) =>
      text.toLowerCase().includes(needle)
    )
  )
}

/** A new empty prompt with an id none of `items` has */
export function newChatPrompt(
  items: readonly ChatPromptConfig[],
  profileId = ''
): ChatPromptConfig {
  return { id: nextNumberedId(items, ID_PREFIX), name: '', rule: '', profileId }
}

/** The prompts with the one at `from` moved to `to` */
export function moveChatPrompt(
  items: readonly ChatPromptConfig[],
  from: number,
  to: number
): ChatPromptConfig[] {
  const result = [...items]
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= result.length ||
    to >= result.length
  ) {
    return result
  }
  const [moved] = result.splice(from, 1)
  result.splice(to, 0, moved!)
  return result
}

const runsPromptOf = (
  action: MainActionConfig | null | undefined,
  promptIds: ReadonlySet<string>
) => action?.type === 'chatPrompt' && promptIds.has(action.promptId)

/** The action slots without the actions that run one of `promptIds` */
export function withoutPromptActions(
  slots: ShortcutSlots<MainActionConfig>,
  promptIds: ReadonlySet<string>
): ShortcutSlots<MainActionConfig> {
  return Object.fromEntries(
    Object.entries(slots).filter(
      ([, action]) => !runsPromptOf(action, promptIds)
    )
  ) as ShortcutSlots<MainActionConfig>
}

/** The custom action slots with the actions that run one of `promptIds` cleared */
export function withoutPromptCustomActions(
  slots: readonly CustomActionSlotConfig[],
  promptIds: ReadonlySet<string>
): CustomActionSlotConfig[] {
  return slots.map((slot) =>
    runsPromptOf(slot.action, promptIds) ? { ...slot, action: null } : slot
  )
}
