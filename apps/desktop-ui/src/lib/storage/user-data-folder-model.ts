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
  const isInspecting = ref(false)
  const isApplying = ref(false)
  const isBusy = computed(() => isInspecting.value || isApplying.value)

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

  /** Starts `next`; going back to the default folder looks at it at once */
  async function start(next: UserDataAction) {
    action.value = next
    target.value = null
    errorMessage.value = ''
    if (next === 'resetToDefault') await inspect()
  }

  function cancel() {
    if (isApplying.value) return
    action.value = null
    target.value = null
    errorMessage.value = ''
  }

  async function pickFolder() {
    try {
      const picked = await deps.pickFolder()
      if (picked) await inspect(picked)
    } catch (error) {
      errorMessage.value = deps.describeError(error)
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
      const path =
        mode === 'resetToDefault' || mode === 'useDefault'
          ? undefined
          : target.value.path
      await deps.relocate(mode, path)
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
