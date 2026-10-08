import { DESKTOP_COMMANDS } from '@tyco/shared'

import { desktopClient } from '../desktop/client'
import { createClientLogger } from './client-logger'

export const clientLogger = createClientLogger({
  send: (level, message, context) => {
    void desktopClient.invoke(DESKTOP_COMMANDS.LOG_CLIENT_MESSAGE, {
      level,
      message,
      context,
    })
  },
})

export * from './client-logger'
