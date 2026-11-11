import { computed, ref } from 'vue'
import type { UserDataRelocationMode, UserDataTarget } from '@tyco/shared'

import {
  describeUserDataRelocation,
  type UserDataAction,
} from './user-data-relocation'

export interface UserDataFolderDependencies {
  /** What a folder holds; none asks about the default folder */
  inspect: (path?: string) => Promise<UserDataTarget>
  /** Changes the folder; the backend restarts the app afterwards */
  relocate: (mode: UserDataRelocationMode, path?: string) => Promise<void>
  /** Saves every pending draft; false when one failed */
  flushDrafts: () => Promise<boolean>
  pickFolder: () => Promise<string | null>
  describeError: (error: unknown) => string
  /** The message when a draft could not be saved before the restart */
  draftsNotSavedMessage: () => string
}

/**
 * Choosing another data folder: the action, the folder it goes to, what that
 * folder holds and what applying it does
 */
export function createUserDataFolderModel(deps: UserDataFolderDependencies) {
  const action = ref<UserDataAction | null>(null)
  const target = ref<UserDataTarget | null>(null)
  const errorMessage = ref('')
  const isPicking = ref(false)
  const isInspecting = ref(false)
  const isApplying = ref(false)
  const isBusy = computed(
    () => isPicking.value || isInspecting.value || isApplying.value
  )

  const relocation = computed(() =>
    action.value && target.value
      ? describeUserDataRelocation(action.value, target.value)
      : null
  )

  async function inspect(path?: string) {
    isInspecting.value = true
    errorMessage.value = ''
    try {
      target.value = await deps.inspect(path)
    } catch (error) {
      target.value = null
      errorMessage.value = deps.describeError(error)
    } finally {
      isInspecting.value = false
    }
  }

  /** Opens the folder picker first; cancels silently if no folder was chosen */
  async function start(next: UserDataAction) {
    if (isBusy.value) return
    isPicking.value = true
    errorMessage.value = ''
    target.value = null
    try {
      const picked = await deps.pickFolder()
      if (!picked) return
      action.value = next
      await inspect(picked)
    } catch (error) {
      action.value = next
      errorMessage.value = deps.describeError(error)
    } finally {
      isPicking.value = false
    }
  }

  function cancel() {
    if (isApplying.value) return
    action.value = null
    target.value = null
    errorMessage.value = ''
  }

  async function pickFolder() {
    if (isBusy.value) return
    isPicking.value = true
    try {
      const picked = await deps.pickFolder()
      if (picked) await inspect(picked)
    } catch (error) {
      errorMessage.value = deps.describeError(error)
    } finally {
      isPicking.value = false
    }
  }

  async function useSubfolder() {
    const path = relocation.value?.subfolderPath
    if (path) await inspect(path)
  }

  /** Applies the change; the app restarts when it succeeds */
  async function apply(): Promise<boolean> {
    const mode = relocation.value?.mode
    if (!mode || !target.value || isBusy.value) return false
    isApplying.value = true
    errorMessage.value = ''
    try {
      if (!(await deps.flushDrafts())) {
        errorMessage.value = deps.draftsNotSavedMessage()
        return false
      }
      await deps.relocate(mode, target.value.path)
      return true
    } catch (error) {
      errorMessage.value = deps.describeError(error)
      return false
    } finally {
      isApplying.value = false
    }
  }

  return {
    action,
    target,
    relocation,
    errorMessage,
    isBusy,
    isApplying,
    start,
    cancel,
    pickFolder,
    useSubfolder,
    apply,
  }
}

export type UserDataFolderModel = ReturnType<typeof createUserDataFolderModel>
