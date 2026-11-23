import { computed, ref, watch } from 'vue'
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
  const moveCurrent = ref(true)
  const isConfirmingCrossDisk = ref(false)
  const errorMessage = ref('')
  const isPicking = ref(false)
  const isInspecting = ref(false)
  const isApplying = ref(false)
  const isBusy = computed(
    () => isPicking.value || isInspecting.value || isApplying.value
  )

  const relocation = computed(() =>
    action.value && target.value
      ? describeUserDataRelocation(
          action.value,
          target.value,
          moveCurrent.value
        )
      : null
  )

  watch([target, moveCurrent], () => {
    isConfirmingCrossDisk.value = false
  })

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

  /**
   * For `choose`, opens the modal with the move option and a button to pick the
   * new location; for `connect`, opens the folder picker first and cancels
   * silently if no folder was chosen.
   */
  async function start(next: UserDataAction) {
    if (isBusy.value) return
    errorMessage.value = ''
    target.value = null
    moveCurrent.value = true
    isConfirmingCrossDisk.value = false
    if (next === 'choose') {
      action.value = next
      return
    }
    isPicking.value = true
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
    isConfirmingCrossDisk.value = false
    errorMessage.value = ''
  }

  function dismissCrossDiskConfirm() {
    if (isApplying.value) return
    isConfirmingCrossDisk.value = false
  }

  function setMoveCurrent(value: boolean) {
    if (isBusy.value) return
    moveCurrent.value = value
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

  /**
   * Applies the change; when moving across disks, asks for confirmation first
   * and returns false until the user confirms. The app restarts when it
   * succeeds.
   */
  async function apply(): Promise<boolean> {
    const mode = relocation.value?.mode
    if (!mode || !target.value || isBusy.value) return false
    if (
      relocation.value?.requiresCrossDiskConfirm &&
      !isConfirmingCrossDisk.value
    ) {
      isConfirmingCrossDisk.value = true
      return false
    }
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
    moveCurrent,
    isConfirmingCrossDisk,
    relocation,
    errorMessage,
    isBusy,
    isApplying,
    start,
    cancel,
    dismissCrossDiskConfirm,
    setMoveCurrent,
    pickFolder,
    useSubfolder,
    apply,
  }
}

export type UserDataFolderModel = ReturnType<typeof createUserDataFolderModel>
