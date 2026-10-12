import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { DESKTOP_COMMANDS, type AppEventPayloads } from '@tyco/shared'

import { invokeDesktop as invoke } from './invoke'
import { formatErrorMessage } from '../logger/client-logger'
import { createDesktopClient } from './desktop-client'

export const desktopClient = createDesktopClient({
  isAvailable: isTauri,
  onEventError: (event, error) => {
    void invoke(DESKTOP_COMMANDS.LOG_CLIENT_MESSAGE, {
      level: 'error',
      message: formatErrorMessage(error),
      context: event,
    }).catch(() => {})
  },
  invoke,
  listen: <EventName extends keyof AppEventPayloads>(
    event: EventName,
    handler: (payload: AppEventPayloads[EventName]) => void | Promise<void>
  ) =>
    listen<AppEventPayloads[EventName]>(event, ({ payload }) => {
      void handler(payload)
    }),
})
