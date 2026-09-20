import { addAPIProvider, addCollection } from '@iconify/vue'

import offlineIcons from 'virtual:offline-icons'

/**
 * Registers the icon subset bundled at build time and disables the Iconify API
 * so a missing icon renders as nothing instead of triggering a network
 * request.
 */
export function registerOfflineIcons() {
  addCollection(offlineIcons)
  addAPIProvider('', { resources: [] })
}
