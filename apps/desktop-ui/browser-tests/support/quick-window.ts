import { DESKTOP_EVENTS } from '@tyco/shared'

import type { FakeDesktop } from './fake-desktop'

/** Only the native window operations needed by quick-window scenarios. */
export function installQuickWindow(desktop: FakeDesktop) {
  desktop.handle('set_quick_input_region', () => undefined)
  desktop.handle('hide_window', () => undefined)
  desktop.handle('hide_quick_window_on_blur', () => undefined)
  let revision = 10
  let activationId = 1
  return {
    async reopen() {
      await desktop.setWindowFocus(true)
      await desktop.emit(DESKTOP_EVENTS.STATE_CHANGED, {
        ...desktop.snapshot(),
        revision: revision++,
        activation: {
          ...desktop.snapshot().activation,
          activationId: ++activationId,
        },
      })
    },
  }
}
