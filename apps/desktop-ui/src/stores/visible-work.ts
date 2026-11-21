import { defineStore } from 'pinia'

import { createVisibleWork } from '../lib/app/visible-work'
import { resultOrThrow } from '../lib/ipc/ipc-model'
import { clientLogger } from '../lib/logger'
import { useIpcStore } from './ipc'

/**
 * The visible work of this window an external request ends first, see
 * `createVisibleWork`. A feature registers how it ends its own
 */
export const useVisibleWorkStore = defineStore('visibleWork', () => {
  const ipcStore = useIpcStore()
  return createVisibleWork({
    answer: async (id) => {
      resultOrThrow(await ipcStore.call('visible_work_ended', { id }))
    },
    reportError: (error) =>
      clientLogger.warn(
        `Could not end the visible work: ${String(error)}`,
        'visible-work'
      ),
  })
})
