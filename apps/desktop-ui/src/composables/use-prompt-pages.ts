import { computed } from 'vue'

import {
  type PromptPageView,
  describePromptPages,
} from '../lib/chat-prompts/prompt-pages'
import { useAiProfilesStore } from '../stores/ai-profiles'
import { useDesktopStore } from '../stores/desktop'
import { useI18n } from './use-i18n'
import type { ChatPromptPageConfig } from '@tyco/shared'

/**
 * The prompt pages with the names of their profiles. `pages` reads them from
 * elsewhere than the saved settings, e.g. from the settings draft.
 */
export function usePromptPages(
  pages?: () => readonly ChatPromptPageConfig[] | undefined
) {
  const desktopStore = useDesktopStore()
  const aiProfilesStore = useAiProfilesStore()
  const { t } = useI18n()

  if (!aiProfilesStore.isLoaded) void aiProfilesStore.loadAll()

  const views = computed<PromptPageView[]>(() =>
    describePromptPages(
      pages ? pages() : desktopStore.userConfig.chatPrompts?.pages,
      {
        profiles: aiProfilesStore.profiles,
        defaultProfileName: t('quickAiRequest.defaultProfile'),
        areProfilesLoaded: aiProfilesStore.isLoaded,
      }
    )
  )

  /** The label of a page: its number and its profile */
  const pageLabel = (view: PromptPageView) =>
    t('chatPrompts.pageLabel', {
      page: view.index + 1,
      profile: view.isProfileMissing
        ? t('chatPrompts.missingProfile')
        : view.profileName,
    })

  return { views, pageLabel }
}
