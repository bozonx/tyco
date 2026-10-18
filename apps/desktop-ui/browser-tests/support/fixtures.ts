import { test as base, expect } from '@playwright/test'

import { FakeDesktop } from './fake-desktop'

interface AppFixtures {
  desktop: FakeDesktop
  /** Page errors, console errors, and Vue or vue-i18n warnings. */
  pageErrors: string[]
}

// a missing locale key is only a warning in vue-i18n, but an error here
const FAILING_WARNING = /^\[(Vue warn|intlify)\]/

/**
 * The main window running against `FakeDesktop`. Configure the backend with
 * `desktop` before calling `page.goto('/')`. The test fails on uncaught page
 * errors, console errors, and Vue or vue-i18n warnings; a test that provokes an
 * expected error removes it from `pageErrors`.
 */
export const test = base.extend<AppFixtures>({
  // auto: the runtime must be in place before any `page.goto`, including one
  // in a hook of a test that never asks for `desktop`
  desktop: [
    async ({ page }, use) => {
      const desktop = new FakeDesktop()
      await desktop.attach(page)
      await use(desktop)
    },
    { auto: true },
  ],
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        const text = message.text()
        if (
          message.type() === 'error' ||
          (message.type() === 'warning' && FAILING_WARNING.test(text))
        )
          errors.push(text)
      })
      await use(errors)
      expect(errors, 'unexpected page errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
