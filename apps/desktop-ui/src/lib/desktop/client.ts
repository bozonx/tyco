import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { AppEventPayloads } from '@tyco/shared'

import { invokeDesktop as invoke } from './invoke'
import { createDesktopClient } from './desktop-client'

export const desktopClient = createDesktopClient({
  isAvailable: isTauri,
  invoke,
  listen: <EventName extends keyof AppEventPayloads>(
    event: EventName,
    handler: (payload: AppEventPayloads[EventName]) => void | Promise<void>
  ) =>
    listen<AppEventPayloads[EventName]>(event, ({ payload }) => {
      void handler(payload)
    }),
})
