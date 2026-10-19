import { test as base, expect, type ConsoleMessage } from '@playwright/test'
import { ActivationMode } from '@tyco/shared'

import { FakeDesktop } from './fake-desktop'

interface BrowserFixtures {
  /** Only explicitly matched, counted console errors are allowed. */
  expectConsoleError: (pattern: RegExp, count?: number) => void
}

interface AppFixtures {
  desktop: FakeDesktop
  expectDesktopError: (pattern: RegExp, count?: number) => void
}

interface AppOptions {
  startMode: ActivationMode
  windowLabel: string
}

const FAILING_WARNING = /^\[(Vue warn|intlify)\]/

type ExpectedError = { pattern: RegExp; count: number }

function assertExpectedErrors(
  errors: string[],
  expected: ExpectedError[],
  label: string
) {
  const remaining = [...errors]
  for (const { pattern, count } of expected) {
    const matches = remaining.filter((message) => {
      pattern.lastIndex = 0
      return pattern.test(message)
    })
    expect.soft(matches, `expected ${label}: ${pattern}`).toHaveLength(count)
    for (const message of matches)
      remaining.splice(remaining.indexOf(message), 1)
  }
  expect(remaining, `unexpected ${label}`).toEqual([])
}

/**
 * Shared by the catalog and application tests; page exceptions are never
 * allowed.
 */
export const browserTest = base.extend<BrowserFixtures>({
  expectConsoleError: [
    async ({ page }, use) => {
      const externalRequests: string[] = []
      await page.route(/^https?:\/\//, async (route) => {
        const url = new URL(route.request().url())
        if (url.origin === 'http://127.0.0.1:3100') await route.continue()
        else {
          externalRequests.push(url.href)
          await route.abort('blockedbyclient')
        }
      })
      await page.routeWebSocket(/.*/, (socket) => {
        externalRequests.push(socket.url())
        socket.close()
      })
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      const expected: ExpectedError[] = []
      const onPageError = (error: Error) => pageErrors.push(error.message)
      const onConsole = (message: ConsoleMessage) => {
        const text = message.text()
        if (
          message.type() === 'error' ||
          (message.type() === 'warning' && FAILING_WARNING.test(text))
        )
          consoleErrors.push(text)
      }
      page.on('pageerror', onPageError)
      page.on('console', onConsole)
      await use((pattern, count = 1) => expected.push({ pattern, count }))
      page.off('pageerror', onPageError)
      page.off('console', onConsole)
      expect.soft(pageErrors, 'uncaught page errors').toEqual([])
      expect
        .soft(externalRequests, 'unexpected external browser requests')
        .toEqual([])
      assertExpectedErrors(
        consoleErrors,
        expected,
        'console errors or framework warnings'
      )
    },
    { auto: true },
  ],
})

/** Every test gets its own backend, installed before navigation. */
export const test = browserTest.extend<AppFixtures & AppOptions>({
  startMode: [ActivationMode.EDITOR, { option: true }],
  windowLabel: ['main', { option: true }],
  expectDesktopError: [
    async ({ desktop }, use) => {
      const expected: ExpectedError[] = []
      await use((pattern, count = 1) => expected.push({ pattern, count }))
      assertExpectedErrors(
        desktop
          .callsOf('log_client_message')
          .filter(({ level }) => level === 'error')
          .map(({ message }) => message),
        expected,
        'desktop client error logs'
      )
    },
    { auto: true },
  ],
  desktop: [
    async ({ page, startMode, windowLabel }, use) => {
      const desktop = new FakeDesktop({ mode: startMode })
      await desktop.attach(page, windowLabel)
      await use(desktop)
      expect(
        [...desktop.unhandledCommands],
        'unhandled desktop commands'
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
