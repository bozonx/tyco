import { errorMessage } from '@tyco/shared/value-guards'
import { computed, ref } from 'vue'
import type { AiProfile } from '@tyco/shared'

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
import type { AiProfilePatch } from './ai-profiles-model'
import {
  parseProfileMaxOutputTokens,
  parseProfileTemperature,
} from './profile-generation'

export interface ProfileEditorDependencies extends AutosaveTimers {
  /** The profile as the app holds it now */
  getProfile: () => AiProfile | undefined
  updateProfile: (patch: AiProfilePatch) => Promise<void>
  readSoul: () => Promise<string>
  writeSoul: (content: string) => Promise<void>
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
  const soulPrompt = ref('')
  const isSoulLoaded = ref(false)
  const isSoulLoading = ref(false)
  const soulLoadError = ref('')
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
      const temperature = parseProfileTemperature(temperatureText.value)
      const maxOutputTokens = parseProfileMaxOutputTokens(
        maxOutputTokensText.value
      )
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
      if (!isSoulLoaded.value) return
      await deps.writeSoul(soulPrompt.value)
    },
  })

  // the profile in the app already holds a failed pick: storing it again
  // stores the pick
  const pickedSaves = createSaveTracker({
    resave: () => deps.updateProfile({}),
  })

  const autosaves = createAutosaveGroup({
    parts: [profileAutosave, soulAutosave, pickedSaves],
    reportError: deps.reportError,
  })

  const loadSoul = (): Promise<void> => {
    if (soulRead) return soulRead
    isSoulLoading.value = true
    soulLoadError.value = ''
    const initialPrompt = soulPrompt.value
    soulRead = Promise.resolve()
      .then(deps.readSoul)
      .then(
        (content) => {
          if (soulPrompt.value === initialPrompt) soulPrompt.value = content
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
      const content = await deps.readSoul()
      if (
        soulPrompt.value === shownPrompt &&
        isSettled(soulAutosave.status.value)
      )
        soulPrompt.value = content
    } catch {
      // the field keeps what it shows; the next save writes it back
    }
  }

  const changeName = () => {
    if (name.value.trim()) profileAutosave.schedule()
  }

  const changeTemperature = (value: string) => {
    temperatureText.value = value
    temperatureError.value = !parseProfileTemperature(value).isValid
    if (!temperatureError.value) profileAutosave.schedule()
  }

  const changeMaxOutputTokens = (value: string) => {
    maxOutputTokensText.value = value
    maxOutputTokensError.value = !parseProfileMaxOutputTokens(value).isValid
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

  /** A picked value: the model, the icon, a switch or an access mode */
  const changeSettings = (patch: AiProfilePatch): Promise<boolean> =>
    pickedSaves.track(deps.updateProfile(patch))

  const saveStatus = computed<AutosaveSummary>(() =>
    soulLoadError.value ? 'error' : autosaves.status.value
  )

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
    soulPrompt,
    isSoulLoaded,
    isSoulLoading,
    soulLoadError,
    loadSoul,
    saveStatus,
    load,
    syncFromStored,
    changeName,
    changeTemperature,
    changeMaxOutputTokens,
    changeStepCount,
    changeSoul,
    changeSettings,
    flush,
    /** Forgets the waiting changes of a profile about to be removed */
    cancel: autosaves.cancel,
  }
}
