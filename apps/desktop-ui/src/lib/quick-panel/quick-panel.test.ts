import { describe, expect, it, vi } from 'vitest'

import { APP_ROUTES } from '../navigation/routes'
import {
  createQuickPanelModel,
  isQuickPanelPath,
  type QuickPanelDeps,
} from './quick-panel'

function createDeps(overrides: Partial<QuickPanelDeps> = {}): QuickPanelDeps {
  return { focusInput: vi.fn(), applyNavParams: vi.fn(), ...overrides }
}

describe('quick-panel', () => {
  it('treats the editor path as a quick panel path', () => {
    expect(isQuickPanelPath(APP_ROUTES.EDITOR.path)).toBe(true)
    expect(isQuickPanelPath(APP_ROUTES.CONFIG.path)).toBe(false)
  })

  it('starts inactive', () => {
    const model = createQuickPanelModel(createDeps())

    expect(model.isActive.value).toBe(false)
  })

  it('applies nav params and focuses the input on enter', () => {
    const deps = createDeps()
    const model = createQuickPanelModel(deps)

    model.syncRoute(APP_ROUTES.EDITOR.path)

    expect(model.isActive.value).toBe(true)
    expect(deps.applyNavParams).toHaveBeenCalledTimes(1)
    expect(deps.focusInput).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the route changes within the quick panel', () => {
    const deps = createDeps()
    const model = createQuickPanelModel(deps)

    model.syncRoute(APP_ROUTES.EDITOR.path)
    model.syncRoute(APP_ROUTES.EDITOR.path)

    expect(deps.applyNavParams).toHaveBeenCalledTimes(1)
    expect(deps.focusInput).toHaveBeenCalledTimes(1)
  })

  it('becomes inactive on leave', () => {
    const model = createQuickPanelModel(createDeps())

    model.syncRoute(APP_ROUTES.EDITOR.path)
    model.syncRoute(APP_ROUTES.CONFIG.path)

    expect(model.isActive.value).toBe(false)
  })

  it('re-enters after leaving', () => {
    const deps = createDeps()
    const model = createQuickPanelModel(deps)

    model.syncRoute(APP_ROUTES.EDITOR.path)
    model.syncRoute(APP_ROUTES.HISTORY.path)
    model.syncRoute(APP_ROUTES.EDITOR.path)

    expect(model.isActive.value).toBe(true)
    expect(deps.applyNavParams).toHaveBeenCalledTimes(2)
    expect(deps.focusInput).toHaveBeenCalledTimes(2)
  })

  it('keeps the focus in the field when the window is hidden', () => {
    const deps = createDeps()
    const model = createQuickPanelModel(deps)

    model.syncRoute(APP_ROUTES.EDITOR.path)
    model.syncWindowVisibility()

    expect(deps.focusInput).toHaveBeenCalledTimes(2)
  })

  it('ignores window visibility while another view is active', () => {
    const deps = createDeps()
    const model = createQuickPanelModel(deps)

    model.syncWindowVisibility()

    expect(deps.focusInput).not.toHaveBeenCalled()
  })
})
