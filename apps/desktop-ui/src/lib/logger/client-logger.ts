import type { App } from 'vue'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export type ClientLogScope =
  | 'router'
  | 'chat'
  | 'ai-profiles'
  | 'translation'
  | 'stt'
  | 'llm'
  | 'ipc'
  | 'history'
  | 'bootstrap'
  | 'external-commands'
  | (string & {})

export interface ClientLoggerSender {
  send: (
    level: LogLevel,
    message: string,
    context?: ClientLogScope
  ) => Promise<void> | void
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.stack) {
      return `${error.name}: ${error.message}\n${error.stack}`
    }
    return `${error.name}: ${error.message}`
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function createClientLogger(sender: ClientLoggerSender) {
  function log(level: LogLevel, message: string, context?: ClientLogScope) {
    try {
      void sender.send(level, message, context)
    } catch {
      // Logging should never throw
    }
  }

  function error(message: string, err?: unknown, context?: ClientLogScope) {
    const fullMessage =
      err !== undefined ? `${message}: ${formatErrorMessage(err)}` : message
    log('error', fullMessage, context)
  }

  function warn(message: string, context?: ClientLogScope) {
    log('warn', message, context)
  }

  function info(message: string, context?: ClientLogScope) {
    log('info', message, context)
  }

  function debug(message: string, context?: ClientLogScope) {
    log('debug', message, context)
  }

  function setupGlobalHandlers(
    app: App,
    target: Pick<EventTarget, 'addEventListener'> = window
  ) {
    app.config.errorHandler = (err, _instance, infoText) => {
      error(`Vue error (${infoText})`, err, 'vue')
    }

    target.addEventListener('error', ((event: ErrorEvent) => {
      error(
        `Uncaught error: ${event.message}`,
        event.error ?? `${event.filename}:${event.lineno}:${event.colno}`,
        'window'
      )
    }) as EventListener)

    target.addEventListener('unhandledrejection', ((
      event: PromiseRejectionEvent
    ) => {
      error('Unhandled promise rejection', event.reason, 'promise')
    }) as EventListener)
  }

  return { log, error, warn, info, debug, setupGlobalHandlers }
}
