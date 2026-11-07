import type { ChatPromptConfig, ChatPromptPageConfig } from '@tyco/shared'

import { slotItemLabel, slotItemList } from '../shortcut-slots/slot-library'

/** A profile a prompt page may run with */
export interface PromptPageProfile {
  id: string
  name: string
}

/** A prompt page as the menus show it */
export interface PromptPageView {
  index: number
  page: ChatPromptPageConfig
  /** The name of the profile of the page; empty when the profile is gone */
  profileName: string
  /** The page names a profile that no longer exists */
  isProfileMissing: boolean
}

/** A prompt of a menu slot that can run: it has a rule */
export interface PromptSlot {
  prompt: ChatPromptConfig
  label: string
}

export interface DescribePromptPagesOptions {
  profiles: readonly PromptPageProfile[]
  /** The name of the default profile, the one of an empty `profileId` */
  defaultProfileName: string
  /**
   * Whether the profile list is known; until then no page is reported as
   * missing its profile
   */
  areProfilesLoaded: boolean
}

export function describePromptPages(
  pages: readonly ChatPromptPageConfig[] | undefined,
  options: DescribePromptPagesOptions
): PromptPageView[] {
  return (pages ?? []).map((page, index) => {
    if (!page.profileId) {
      return {
        index,
        page,
        profileName: options.defaultProfileName,
        isProfileMissing: false,
      }
    }
    const profile = options.profiles.find((item) => item.id === page.profileId)
    return {
      index,
      page,
      profileName: profile?.name ?? '',
      isProfileMissing: options.areProfilesLoaded && !profile,
    }
  })
}

/** The pages that run with `profileId`; `null` stands for the default one */
export function promptPagesOfProfile(
  pages: readonly PromptPageView[],
  profileId: string | null | undefined
): PromptPageView[] {
  const id = profileId ?? ''
  return pages.filter((view) => view.page.profileId === id)
}

/** The slots of a page in key order; a slot without a runnable prompt is `null` */
export function promptSlots(
  page: ChatPromptPageConfig | undefined
): (PromptSlot | null)[] {
  return slotItemList(page).map((prompt) =>
    prompt?.rule.trim() ? { prompt, label: slotItemLabel(prompt) } : null
  )
}
