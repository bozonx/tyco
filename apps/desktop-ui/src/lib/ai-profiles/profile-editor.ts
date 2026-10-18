import { computed, ref, watch } from 'vue'
import type { AiProfile } from '@tyco/shared'

import { createAutosave } from '../settings/autosave'
import {
  parseProfileMaxOutputTokens,
  parseProfileTemperature,
} from './profile-generation'

export type ProfileEditorSaveStatus = 'error' | 'saving' | 'saved' | ''

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

  /** Fills the fields from the stored profile, once */
  const load = async (profile: AiProfile): Promise<void> => {
    if (isSoulLoaded.value) return
    name.value = profile.name
    temperatureText.value = String(profile.temperature ?? '')
    maxOutputTokensText.value = String(profile.maxOutputTokens ?? '')
    try {
      soulPrompt.value = await deps.readSoul()
      isSoulLoaded.value = true
    } catch (error) {
      deps.reportError(String(error))
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

  const changeSoul = () => soulAutosave.schedule()

  const saveStatus = computed<ProfileEditorSaveStatus>(() => {
    const statuses = [profileAutosave.status.value, soulAutosave.status.value]
    if (statuses.includes('error')) return 'error'
    if (statuses.includes('saving') || statuses.includes('pending'))
      return 'saving'
    if (statuses.includes('saved')) return 'saved'
    return ''
  })

  watch(
    () => profileAutosave.error.value || soulAutosave.error.value,
    (message) => {
      if (message) deps.reportError(message)
    }
  )

  /** Saves the waiting changes now, e.g. when the page is left */
  const flush = async () => {
    await Promise.all([profileAutosave.flush(), soulAutosave.flush()])
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
