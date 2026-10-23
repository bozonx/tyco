import type { AiProfile } from '@tyco/shared'
import { ref } from 'vue'

export interface ChatProfileRuntimeDependencies {
  profileId: string | null
  loadChatHistory: () => Promise<void>
  refreshProfile: (profileId: string) => Promise<AiProfile | undefined>
  readSoul: (profileId: string) => Promise<string>
  warn: (message: string) => void
}

/**
 * Coordinates the runtime state of a profile chat (`SOUL.md`, last opened chat,
 * and initial history/profile preparation). No-ops when `profileId` is null.
 */
export function createChatProfileRuntime(deps: ChatProfileRuntimeDependencies) {
  /** The profile's root instruction as last read from `SOUL.md` */
  const soul = ref('')
  /** The chat to reopen, known before the session state stores it */
  const lastProfileChatId = ref<string | null>(null)

  /**
   * Reads `SOUL.md` and `profile.json` anew: the user may edit them by hand
   * between two requests
   */
  const refreshProfile = async () => {
    if (!deps.profileId) return undefined
    const [stored, content] = await Promise.all([
      deps.refreshProfile(deps.profileId),
      deps.readSoul(deps.profileId),
    ])
    soul.value = content
    return stored
  }

  let profileReady: Promise<void> | null = null
  /** The history and the root instruction a profile chat starts with */
  const prepareProfile = () => {
    if (!deps.profileId) return Promise.resolve()
    profileReady ??= Promise.all([
      deps.loadChatHistory(),
      refreshProfile(),
    ]).then(
      () => {},
      (error: unknown) => {
        profileReady = null
        deps.warn(
          `Could not read the profile ${deps.profileId}: ${String(error)}`
        )
      }
    )
    return profileReady
  }

  return { soul, lastProfileChatId, refreshProfile, prepareProfile }
}
