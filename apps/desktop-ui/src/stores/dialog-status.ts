import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Whether a dialog runs, for the parts of the app that show it without loading
 * the dialog itself (the nav tab). `stores/dialog` keeps it up to date; until
 * the dialog view is first opened, nothing runs.
 */
export const useDialogStatusStore = defineStore('dialogStatus', () => {
  const isActive = ref(false)
  const isRecording = ref(false)
  return { isActive, isRecording }
})
