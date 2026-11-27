import { defineStore } from 'pinia'
import { markRaw } from 'vue'

import { invokeDesktop } from '../lib/desktop/invoke'
import { clientLogger } from '../lib/logger'
import { createSystemContext } from '../lib/system-context/system-context'

/** The date, time zone and system every assistant of this window is told */
export const useSystemContextStore = defineStore('system-context', () => ({
  context: markRaw(
    createSystemContext({
      loadSystemInfo: () => invokeDesktop('get_system_info'),
      warn: (message) => clientLogger.warn(message, 'chat'),
    })
  ),
}))
