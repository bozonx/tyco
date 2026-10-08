import { describe, expect, it } from 'vitest'
import type { App } from 'vue'

import {
  createClientLogger,
  formatErrorMessage,
  type LogLevel,
} from './client-logger'

describe('client-logger', () => {
  it('formats errors with name, message and stack', () => {
    const error = new Error('test boom')
    const formatted = formatErrorMessage(error)
    expect(formatted).toContain('Error: test boom')
  })

  it('formats non-error objects and primitives', () => {
    expect(formatErrorMessage('raw string')).toBe('raw string')
    expect(formatErrorMessage({ code: 404 })).toBe('{"code":404}')
  })

  it('dispatches log messages through sender', () => {
    const messages: Array<{
      level: LogLevel
      message: string
      context?: string
    }> = []
    const logger = createClientLogger({
      send: (level, message, context) => {
        messages.push({ level, message, context })
      },
    })

    logger.info('app started', 'init')
    logger.warn('deprecated feature', 'ui')
    logger.error('failed task', new Error('network down'), 'net')

    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({
      level: 'info',
      message: 'app started',
      context: 'init',
    })
    expect(messages[1]).toEqual({
      level: 'warn',
      message: 'deprecated feature',
      context: 'ui',
    })
    expect(messages[2]?.level).toBe('error')
    expect(messages[2]?.message).toContain('failed task: Error: network down')
    expect(messages[2]?.context).toBe('net')
  })

  it('hooks global error handlers for Vue and window', () => {
    const messages: Array<{
      level: LogLevel
      message: string
      context?: string
    }> = []
    const logger = createClientLogger({
      send: (level, message, context) => {
        messages.push({ level, message, context })
      },
    })

    const appMock = { config: {} } as unknown as App

    const listeners: Record<string, EventListener> = {}
    const targetMock = {
      addEventListener: (event: string, listener: EventListener) => {
        listeners[event] = listener
      },
    }

    logger.setupGlobalHandlers(appMock, targetMock)

    expect(typeof appMock.config.errorHandler).toBe('function')
    appMock.config.errorHandler!(new Error('render fail'), null, 'v-on handler')

    expect(messages).toHaveLength(1)
    expect(messages[0]?.level).toBe('error')
    expect(messages[0]?.context).toBe('vue')
    expect(messages[0]?.message).toContain('render fail')

    listeners['error']!({
      message: 'script error',
      error: new Error('script boom'),
      filename: 'foo.js',
      lineno: 10,
      colno: 2,
    } as unknown as ErrorEvent)

    expect(messages).toHaveLength(2)
    expect(messages[1]?.context).toBe('window')
    expect(messages[1]?.message).toContain('script boom')

    listeners['unhandledrejection']!({
      reason: new Error('rejection boom'),
    } as unknown as PromiseRejectionEvent)

    expect(messages).toHaveLength(3)
    expect(messages[2]?.context).toBe('promise')
    expect(messages[2]?.message).toContain('rejection boom')
  })
})
