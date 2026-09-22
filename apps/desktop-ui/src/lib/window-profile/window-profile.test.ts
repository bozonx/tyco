import { describe, expect, it } from 'vitest'

import { APP_ROUTES } from '../navigation/routes'
import { sheetTitleKey } from './window-profile'

describe('window profile', () => {
  it('returns titles only for sheet routes', () => {
    expect(sheetTitleKey(APP_ROUTES.CHAT.path)).toBe('nav.chat')
    expect(sheetTitleKey(APP_ROUTES.HISTORY.path)).toBe('nav.history')
    expect(sheetTitleKey(APP_ROUTES.CONFIG.path)).toBe('nav.settings')
    expect(sheetTitleKey(APP_ROUTES.EDITOR.path)).toBeNull()
    expect(sheetTitleKey(APP_ROUTES.WRITE.path)).toBeNull()
  })
})
