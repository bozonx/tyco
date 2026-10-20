import { defineStore } from 'pinia'
import { useIpcStore } from './ipc'

export const useWindowStore = defineStore('window', () => {
  const ipc = useIpcStore()
  const hide = () => ipc.callOrNotify('hide_window')
  return { hide }
})
