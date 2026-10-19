import { desktopClient } from '../desktop/client'
import { createClientLogger } from './client-logger'

export const clientLogger = createClientLogger({
  send: (level, message, context) => {
    void desktopClient.invoke('log_client_message', { level, message, context })
  },
})

export * from './client-logger'
