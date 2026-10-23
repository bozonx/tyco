import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { type DesktopEventPayloads } from '@tyco/shared'

import { invokeDesktop as invoke } from './invoke'
import { formatErrorMessage } from '../logger/client-logger'
import { createDesktopClient } from './desktop-client'

export const desktopClient = createDesktopClient({
  isAvailable: isTauri,
  onEventError: (event, error) => {
    void invoke('log_client_message', {
      level: 'error',
      message: formatErrorMessage(error),
      context: event,
    }).catch(() => {})
  },
  invoke,
  listen: <EventName extends keyof DesktopEventPayloads>(
    event: EventName,
    handler: (payload: DesktopEventPayloads[EventName]) => void | Promise<void>
  ) =>
    // Addressed backend events only reach listeners with a matching target.
    // Broadcast events still reach every window's listener.
    listen<DesktopEventPayloads[EventName]>(
      event,
      ({ payload }) => {
        void handler(payload)
      },
      { target: { kind: 'AnyLabel', label: getCurrentWindow().label } }
    ),
})
