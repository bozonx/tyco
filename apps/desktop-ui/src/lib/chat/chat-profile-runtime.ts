import type { AiProfile, ProfileMemoryTopic } from '@tyco/shared'
import { computed, ref } from 'vue'

import { buildProfileMemoryBlock } from './chat-profile-memory'

export interface ChatProfileRuntimeDependencies {
  profileId: string | null
  loadChatHistory: () => Promise<void>
  refreshProfile: (profileId: string) => Promise<AiProfile | undefined>
  readSoul: (profileId: string) => Promise<string>
  readCoreMemory?: (profileId: string) => Promise<string>
  listMemoryTopics?: (profileId: string) => Promise<ProfileMemoryTopic[]>
  warn: (message: string) => void
}

/**
 * Coordinates the runtime state of a profile chat (`SOUL.md`, memory, last
 * opened chat, and initial history/profile preparation). No-ops when
 * `profileId` is null.
 */
export function createChatProfileRuntime(deps: ChatProfileRuntimeDependencies) {
  /** The profile's root instruction as last read from `SOUL.md` */
  const soul = ref('')
  /** The chat to reopen, known before the session state stores it */
  const lastProfileChatId = ref<string | null>(null)
  /** The <profile_memory> block for the profile's instructions */
  const memoryBlock = ref<string | null>(null)
  /** Whether core.md had to be clipped due to exceeding the hard token limit */
  const isCoreClipped = ref(false)
  /** Warnings about memory size */
  const memoryWarnings = ref<string[]>([])

  /** Combines SOUL.md with <profile_memory> into complete instructions */
  const fullInstructions = computed(() =>
    [soul.value, memoryBlock.value].filter(Boolean).join('\n\n')
  )

  /**
   * Reads `SOUL.md`, `profile.json` and memory anew: the user or model may edit
   * them between two requests
   */
  const refreshProfile = async () => {
    if (!deps.profileId) return undefined
    const [stored, content] = await Promise.all([
      deps.refreshProfile(deps.profileId),
      deps.readSoul(deps.profileId),
    ])
    soul.value = content

    if (
      stored?.memoryMode &&
      stored.memoryMode !== 'off' &&
      deps.readCoreMemory
    ) {
      try {
        const [coreText, topics] = await Promise.all([
          deps.readCoreMemory(deps.profileId),
          deps.listMemoryTopics
            ? deps.listMemoryTopics(deps.profileId)
            : Promise.resolve([]),
        ])
        const memoryContext = buildProfileMemoryBlock({ coreText, topics })
        memoryBlock.value = memoryContext.block
        isCoreClipped.value = memoryContext.isCoreClipped
        memoryWarnings.value = memoryContext.warnings
      } catch (error) {
        memoryBlock.value = null
        isCoreClipped.value = false
        memoryWarnings.value = []
        deps.warn(
          `Could not read profile memory for ${deps.profileId}: ${String(error)}`
        )
      }
    } else {
      memoryBlock.value = null
      isCoreClipped.value = false
      memoryWarnings.value = []
    }

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

  return {
    soul,
    memoryBlock,
    isCoreClipped,
    memoryWarnings,
    fullInstructions,
    lastProfileChatId,
    refreshProfile,
    prepareProfile,
  }
}
