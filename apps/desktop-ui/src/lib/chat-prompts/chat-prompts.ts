import type {
  ChatPromptConfig,
  ChatPromptsConfig,
  CustomActionSlotConfig,
  MainActionConfig,
  ShortcutSlots,
  UserConfig,
} from '@tyco/shared'

import { nameFromPrompt, nextNumberedId } from '../shortcut-slots/slot-prompt'
import { configProfileKey } from '../ai-profiles/profile-ref'

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
   * The profile the prompt runs with outside a chat; `null` for the plain quick
   * AI request, as for a prompt whose profile is gone
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
  /**
   * The attached vaults that are there; the prompts of a profile of another one
   * are hidden until it is back. Unset: every vault counts
   */
  connectedVaultIds?: readonly string[]
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
  const profileKey = configProfileKey(prompt)
  if (!prompt.profileId) {
    return {
      prompt,
      label,
      profileName: '',
      isProfileMissing: false,
      runProfileId: null,
    }
  }
  const profile = options.profiles.find((item) => item.id === profileKey)
  const isProfileMissing = options.areProfilesLoaded && !profile
  return {
    prompt,
    label,
    profileName: profile?.name ?? '',
    isProfileMissing,
    runProfileId: isProfileMissing ? null : profileKey,
  }
}

/** The prompts that can run, the ones with a text, in list order */
export function describeChatPrompts(
  items: readonly ChatPromptConfig[] | undefined,
  options: DescribeChatPromptsOptions
): ChatPromptView[] {
  const connected = options.connectedVaultIds
  return (items ?? [])
    .filter((prompt) => prompt.rule.trim())
    .filter(
      (prompt) =>
        !connected || !prompt.vaultId || connected.includes(prompt.vaultId)
    )
    .map((prompt) => describeChatPrompt(prompt, options))
}

/**
 * The prompts a chat of `profileId` offers, `null` standing for the chat
 * without a profile: the prompts of every profile, those whose profile is gone,
 * and the prompts of this profile
 */
export function chatPromptsOfProfile(
  views: readonly ChatPromptView[],
  profileId: string | null | undefined
): ChatPromptView[] {
  return views.filter(
    (view) =>
      !view.prompt.profileId ||
      view.isProfileMissing ||
      configProfileKey(view.prompt) === (profileId ?? '')
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

/** The labels of the profile choices the model cannot translate itself */
export interface ChatPromptProfileLabels {
  everyProfile: string
  missingProfile: string
}

/**
 * The profiles a prompt may be given: every profile first, then the profiles,
 * and the profile the prompt names when it is not among them; before the
 * profiles load it shows as its id
 */
export function chatPromptProfileOptions(
  prompt: ChatPromptConfig,
  options: DescribeChatPromptsOptions,
  labels: ChatPromptProfileLabels
): ChatPromptProfile[] {
  const result: ChatPromptProfile[] = [
    { id: '', name: labels.everyProfile },
    ...options.profiles.map(({ id, name }) => ({ id, name })),
  ]
  const profileKey = configProfileKey(prompt)
  if (prompt.profileId && !result.some((item) => item.id === profileKey)) {
    result.push({
      id: profileKey,
      name: options.areProfilesLoaded ? labels.missingProfile : profileKey,
    })
  }
  return result
}

/** The ids of the prompts left without a name and a text */
export function emptyChatPromptIds(
  items: readonly ChatPromptConfig[]
): string[] {
  return items
    .filter((item) => !item.name.trim() && !item.rule.trim())
    .map((item) => item.id)
}

type PromptConfigPart = Pick<
  UserConfig,
  'chatPrompts' | 'actionPages' | 'customActionSlots'
>

/**
 * The parts of the config without the prompts of `promptIds` and the actions
 * that run them
 */
export function withoutChatPrompts(
  config: PromptConfigPart,
  promptIds: readonly string[]
): PromptConfigPart {
  const removed = new Set(promptIds)
  const chatPrompts: ChatPromptsConfig = {
    ...config.chatPrompts,
    items: config.chatPrompts.items.filter((item) => !removed.has(item.id)),
  }
  return {
    chatPrompts,
    actionPages: config.actionPages.map((page) => ({
      ...page,
      slots: withoutPromptActions(page.slots ?? {}, removed),
    })),
    customActionSlots: withoutPromptCustomActions(
      config.customActionSlots,
      removed
    ),
  }
}
