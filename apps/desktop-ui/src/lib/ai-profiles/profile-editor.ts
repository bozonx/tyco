import { errorMessage } from '@tyco/shared/value-guards'
import { computed, ref } from 'vue'
import type { AiProfile, ProfileMemoryMode, ProfileSoul } from '@tyco/shared'

import {
  parseToolStepCount,
  withToolStepCount,
} from '../chat-tools/chat-tool-groups'
import {
  createAutosave,
  createAutosaveGroup,
  createSaveTracker,
  type AutosaveStatus,
  type AutosaveSummary,
  type AutosaveTimers,
} from '../settings/autosave'
import { isIpcErrorCode } from '../ipc/ipc-model'
import type { AiProfilePatch } from './ai-profiles-model'
import {
  parseModelTokenCount,
  parseModelTemperature,
} from '../llm/model-number'

export interface ProfileEditorDependencies extends AutosaveTimers {
  /** The profile as the app holds it now */
  getProfile: () => AiProfile | undefined
  updateProfile: (patch: AiProfilePatch) => Promise<void>
  readSoul: () => Promise<ProfileSoul>
  /** Writes over the file of `expectedRevision`; the new revision */
  writeSoul: (content: string, expectedRevision: string) => Promise<string>
  /** Whether a save of the profile found it changed elsewhere */
  hasProfileConflict: () => boolean
  /** Takes the profile on disk, or stores the one of this window over it */
  resolveProfileConflict: (keepMine: boolean) => Promise<void>
  /** `retry` repeats what failed */
  reportError: (message: string, retry: () => void) => void
}

/** A field with nothing waiting to be saved may take the stored value */
const isSettled = (status: AutosaveStatus) =>
  status === 'idle' || status === 'saved'

/**
 * The settings of a profile and its `SOUL.md`. Typed fields are stored a moment
 * after they change, invalid numbers wait for a valid one; picked values are
 * stored at once. Every save shows in one status
 */
export function createProfileEditor(deps: ProfileEditorDependencies) {
  const name = ref('')
  const temperatureText = ref('')
  const maxOutputTokensText = ref('')
  const stepCountText = ref('')
  const temperatureError = ref(false)
  const maxOutputTokensError = ref(false)
  const stepCountError = ref(false)
  const memoryMode = ref<ProfileMemoryMode>('auto')
  const soulPrompt = ref('')
  const isSoulLoaded = ref(false)
  const isSoulLoading = ref(false)
  const soulLoadError = ref('')
  /** The revision of `SOUL.md` the field shows */
  let soulRevision = ''
  /** A write of `SOUL.md` found it changed on another device or outside TyCo */
  const hasSoulConflict = ref(false)
  const hasConflict = computed(
    () => hasSoulConflict.value || deps.hasProfileConflict()
  )
  let hasLoadedProfile = false
  let soulRead: Promise<void> | null = null
  const timers: AutosaveTimers = {
    delayMs: deps.delayMs,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
  }

  const profileAutosave = createAutosave({
    ...timers,
    save: async () => {
      const temperature = parseModelTemperature(temperatureText.value)
      const maxOutputTokens = parseModelTokenCount(maxOutputTokensText.value)
      const stepCount = parseToolStepCount(stepCountText.value)
      const tools = deps.getProfile()?.tools
      await deps.updateProfile({
        ...(name.value.trim() ? { name: name.value.trim() } : {}),
        ...(temperature.isValid ? { temperature: temperature.value } : {}),
        ...(maxOutputTokens.isValid
          ? { maxOutputTokens: maxOutputTokens.value }
          : {}),
        ...(stepCount.isValid && stepCount.value !== tools?.maxStepCount
          ? { tools: withToolStepCount(tools, stepCount.value) }
          : {}),
      })
    },
  })

  const soulAutosave = createAutosave({
    ...timers,
    save: async () => {
      // the field shows the file only once it has been read
      if (!isSoulLoaded.value || hasSoulConflict.value) return
      try {
        soulRevision = await deps.writeSoul(soulPrompt.value, soulRevision)
      } catch (error) {
        if (isIpcErrorCode(error, 'staleRevision')) hasSoulConflict.value = true
        throw error
      }
    },
  })

  // the profile in the app already holds a failed pick: storing it again
  // stores the pick
  const pickedSaves = createSaveTracker({
    resave: () => deps.updateProfile({}),
  })

  const autosaves = createAutosaveGroup({
    parts: [profileAutosave, soulAutosave, pickedSaves],
    // a conflict is shown with its own choice, not as a failure
    reportError: (message, retry) => {
      if (!hasConflict.value) deps.reportError(message, retry)
    },
  })

  const loadSoul = (): Promise<void> => {
    if (soulRead) return soulRead
    isSoulLoading.value = true
    soulLoadError.value = ''
    const initialPrompt = soulPrompt.value
    soulRead = Promise.resolve()
      .then(deps.readSoul)
      .then(
        ({ content, revision }) => {
          if (soulPrompt.value === initialPrompt) soulPrompt.value = content
          soulRevision = revision
          isSoulLoaded.value = true
        },
        (error: unknown) => {
          soulLoadError.value = errorMessage(error)
          deps.reportError(soulLoadError.value, () => void loadSoul())
        }
      )
      .finally(() => {
        isSoulLoading.value = false
        soulRead = null
      })
    return soulRead
  }

  const fillFields = (profile: AiProfile) => {
    name.value = profile.name
    temperatureText.value = String(profile.temperature ?? '')
    maxOutputTokensText.value = String(profile.maxOutputTokens ?? '')
    stepCountText.value = String(profile.tools?.maxStepCount ?? '')
    memoryMode.value = profile.memoryMode ?? 'auto'
    temperatureError.value = false
    maxOutputTokensError.value = false
    stepCountError.value = false
  }

  /** Fills profile fields once; a failed instruction read can be retried. */
  const load = async (profile: AiProfile): Promise<void> => {
    if (!hasLoadedProfile) {
      fillFields(profile)
      hasLoadedProfile = true
    }
    if (!isSoulLoaded.value) await loadSoul()
  }

  /**
   * Takes the profile and `SOUL.md` as they are on disk now, e.g. edited by
   * hand while the app was in the background; a field being typed in keeps what
   * was typed
   */
  const syncFromStored = async (profile: AiProfile): Promise<void> => {
    if (hasLoadedProfile && isSettled(profileAutosave.status.value))
      fillFields(profile)
    if (!isSoulLoaded.value || !isSettled(soulAutosave.status.value)) return
    const shownPrompt = soulPrompt.value
    try {
      const { content, revision } = await deps.readSoul()
      if (
        soulPrompt.value === shownPrompt &&
        isSettled(soulAutosave.status.value)
      ) {
        soulPrompt.value = content
        soulRevision = revision
      }
    } catch {
      // the field keeps what it shows; the next save writes it back
    }
  }

  const changeName = () => {
    if (name.value.trim()) profileAutosave.schedule()
  }

  const changeTemperature = (value: string) => {
    temperatureText.value = value
    temperatureError.value = !parseModelTemperature(value).isValid
    if (!temperatureError.value) profileAutosave.schedule()
  }

  const changeMaxOutputTokens = (value: string) => {
    maxOutputTokensText.value = value
    maxOutputTokensError.value = !parseModelTokenCount(value).isValid
    if (!maxOutputTokensError.value) profileAutosave.schedule()
  }

  const changeStepCount = (value: string) => {
    stepCountText.value = value
    stepCountError.value = !parseToolStepCount(value).isValid
    if (!stepCountError.value) profileAutosave.schedule()
  }

  const changeSoul = () => {
    if (isSoulLoaded.value) soulAutosave.schedule()
  }

  /** A picked value: the model, a switch or an access mode */
  const changeSettings = (patch: AiProfilePatch): Promise<boolean> =>
    pickedSaves.track(deps.updateProfile(patch))

  const saveStatus = computed<AutosaveSummary>(() =>
    soulLoadError.value ? 'error' : autosaves.status.value
  )

  const changeMemoryMode = (mode: ProfileMemoryMode) => {
    memoryMode.value = mode
    void changeSettings({ memoryMode: mode })
  }

  /**
   * Ends a conflict: rereads the profile and `SOUL.md` from disk, or stores
   * what this window shows over them
   */
  const resolveConflict = async (keepMine: boolean): Promise<void> => {
    if (deps.hasProfileConflict()) await deps.resolveProfileConflict(keepMine)
    if (hasSoulConflict.value) {
      const stored = await deps.readSoul()
      soulRevision = stored.revision
      if (!keepMine) soulPrompt.value = stored.content
      hasSoulConflict.value = false
    }
    if (keepMine) {
      profileAutosave.schedule()
      soulAutosave.schedule()
      await autosaves.flush()
      return
    }
    autosaves.cancel()
    const profile = deps.getProfile()
    if (profile) fillFields(profile)
  }

  /** Saves the waiting changes now, e.g. when the page is left */
  const flush = async () => (await autosaves.flush()) && !soulLoadError.value

  return {
    name,
    temperatureText,
    maxOutputTokensText,
    stepCountText,
    temperatureError,
    maxOutputTokensError,
    stepCountError,
    memoryMode,
    soulPrompt,
    isSoulLoaded,
    isSoulLoading,
    soulLoadError,
    hasConflict,
    resolveConflict,
    loadSoul,
    saveStatus,
    load,
    syncFromStored,
    changeName,
    changeTemperature,
    changeMaxOutputTokens,
    changeStepCount,
    changeMemoryMode,
    changeSoul,
    changeSettings,
    flush,
    /** Forgets the waiting changes of a profile about to be removed */
    cancel: autosaves.cancel,
  }
}
