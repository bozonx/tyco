import { defineStore } from 'pinia'

import { useDesktopRuntimeStore } from './desktop-runtime'

/**
 * What the backend tells the window: the settings, the session, the current
 * activation and the window itself
 */
export const useDesktopStore = defineStore('desktop', () =>
  useDesktopRuntimeStore().stateModel()
)
