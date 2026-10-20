import { computed, ref, watch } from 'vue'
import type { AiProfile } from '@tyco/shared'

import {
  createAutosave,
  summarizeAutosave,
  type AutosaveSummary,
} from '../settings/autosave'
import {
  parseProfileMaxOutputTokens,
  parseProfileTemperature,
} from './profile-generation'

export interface ProfileEditorDependencies {
  updateProfile: (patch: Partial<AiProfile>) => Promise<void>
  readSoul: () => Promise<string>
  writeSoul: (content: string) => Promise<void>
  reportError: (message: string) => void
  /** Autosave waits this long after the last keystroke */
  delayMs: number
  setTimer?: (run: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * The text fields of a profile and its `SOUL.md`, each stored on its own a
 * moment after it changes; invalid numbers wait for a valid one
 */
export function createProfileEditor(deps: ProfileEditorDependencies) {
  const name = ref('')
  const temperatureText = ref('')
  const maxOutputTokensText = ref('')
  const temperatureError = ref(false)
  const maxOutputTokensError = ref(false)
  const soulPrompt = ref('')
  const isSoulLoaded = ref(false)
  const isSoulLoading = ref(false)
  const soulLoadError = ref('')
  let hasLoadedProfile = false
  let soulRead: Promise<void> | null = null
  const timers = { setTimer: deps.setTimer, clearTimer: deps.clearTimer }

  const profileAutosave = createAutosave({
    ...timers,
    delayMs: deps.delayMs,
    save: async () => {
      const temperature = parseProfileTemperature(temperatureText.value)
      const maxOutputTokens = parseProfileMaxOutputTokens(
        maxOutputTokensText.value
      )
      await deps.updateProfile({
        ...(name.value.trim() ? { name: name.value.trim() } : {}),
        ...(temperature.isValid ? { temperature: temperature.value } : {}),
        ...(maxOutputTokens.isValid
          ? { maxOutputTokens: maxOutputTokens.value }
          : {}),
      })
    },
  })

  const soulAutosave = createAutosave({
    ...timers,
    delayMs: deps.delayMs,
    save: async () => {
      // the field shows the file only once it has been read
      if (!isSoulLoaded.value) return
      await deps.writeSoul(soulPrompt.value)
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
        (content) => {
          if (soulPrompt.value === initialPrompt) soulPrompt.value = content
          isSoulLoaded.value = true
        },
        (error: unknown) => {
          soulLoadError.value = String(error)
          deps.reportError(soulLoadError.value)
        }
      )
      .finally(() => {
        isSoulLoading.value = false
        soulRead = null
      })
    return soulRead
  }

  /** Fills profile fields once; a failed instruction read can be retried. */
  const load = async (profile: AiProfile): Promise<void> => {
    if (!hasLoadedProfile) {
      name.value = profile.name
      temperatureText.value = String(profile.temperature ?? '')
      maxOutputTokensText.value = String(profile.maxOutputTokens ?? '')
      hasLoadedProfile = true
    }
    if (!isSoulLoaded.value) await loadSoul()
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

  const changeSoul = () => {
    if (isSoulLoaded.value) soulAutosave.schedule()
  }

  const saveStatus = computed<AutosaveSummary>(() =>
    soulLoadError.value
      ? 'error'
      : summarizeAutosave([
          profileAutosave.status.value,
          soulAutosave.status.value,
        ])
  )

  watch(
    () => profileAutosave.error.value || soulAutosave.error.value,
    (message) => {
      if (message) deps.reportError(message)
    }
  )

  /** Saves the waiting changes now, e.g. when the page is left */
  const flush = async () => {
    const saved = await Promise.all([
      profileAutosave.flush(),
      soulAutosave.flush(),
    ])
    return saved.every(Boolean) && !soulLoadError.value
  }

  /** Forgets the waiting changes of a profile about to be removed */
  const cancel = () => {
    profileAutosave.cancel()
    soulAutosave.cancel()
  }

  return {
    name,
    temperatureText,
    maxOutputTokensText,
    temperatureError,
    maxOutputTokensError,
    soulPrompt,
    isSoulLoaded,
    isSoulLoading,
    soulLoadError,
    loadSoul,
    saveStatus,
    load,
    changeName,
    changeTemperature,
    changeMaxOutputTokens,
    changeSoul,
    flush,
    cancel,
  }
}
