import { describe, expect, it } from 'vitest'
import { ActivationMode } from '@tyco/shared'
import { APP_ROUTES, isQuickWindowMode, resolveModeRoute } from './routes'

describe('routes', () => {
  it('resolves routes for styling and transformation modes', () => {
    expect(resolveModeRoute(ActivationMode.STYLING)).toBe(
      APP_ROUTES.STYLING.path
    )
    expect(resolveModeRoute(ActivationMode.TRANSFORMATION)).toBe(
      APP_ROUTES.TRANSFORMATION.path
    )
  })

  it('identifies styling and transformation as quick window modes', () => {
    expect(isQuickWindowMode(ActivationMode.STYLING)).toBe(true)
    expect(isQuickWindowMode(ActivationMode.TRANSFORMATION)).toBe(true)
  })

  it('falls back to home route when mode is null', () => {
    expect(resolveModeRoute(null)).toBe(APP_ROUTES.HOME.path)
    expect(isQuickWindowMode(null)).toBe(false)
  })
})
