import { describe, expect, it } from 'vitest'
import type { UserDataTarget } from '@tyco/shared'

import { describeUserDataRelocation } from './user-data-relocation'

const target = (contents: UserDataTarget['contents']): UserDataTarget => ({
  path: '/sync/TyCo',
  isDefault: false,
  contents,
})

describe('describeUserDataRelocation', () => {
  it('moves into an empty folder and connects one with data, never the other way', () => {
    expect(
      describeUserDataRelocation('move', target({ kind: 'empty' }))
    ).toMatchObject({ mode: 'move' })
    expect(
      describeUserDataRelocation('connect', target({ kind: 'empty' }))
    ).toMatchObject({
      mode: null,
      notice: { messageKey: 'settings.userData.targetEmptyConnect' },
    })
    const data = target({
      kind: 'userData',
      formatVersion: 1,
      isSupported: true,
    })
    expect(describeUserDataRelocation('connect', data)).toMatchObject({
      mode: 'connect',
      notice: { kind: 'warning' },
    })
    expect(describeUserDataRelocation('move', data)).toMatchObject({
      mode: null,
      notice: { messageKey: 'settings.userData.targetUserDataMove' },
    })
  })

  it('refuses a folder of a newer layout, an unfinished sync and app folders', () => {
    for (const action of ['move', 'connect'] as const) {
      expect(
        describeUserDataRelocation(
          action,
          target({ kind: 'userData', formatVersion: 2, isSupported: false })
        ).mode
      ).toBeNull()
      expect(
        describeUserDataRelocation(action, target({ kind: 'unfinished' }))
      ).toMatchObject({
        mode: null,
        notice: { messageKey: 'settings.userData.targetUnfinished' },
      })
      expect(
        describeUserDataRelocation(action, target({ kind: 'forbidden' }))
      ).toMatchObject({ mode: null, notice: { kind: 'error' } })
    }
  })

  it('offers a subfolder of a folder holding other files', () => {
    expect(
      describeUserDataRelocation(
        'move',
        target({ kind: 'occupied', subfolderPath: '/docs/TyCo' })
      )
    ).toMatchObject({ mode: null, subfolderPath: '/docs/TyCo' })
  })

  it('goes back to the default folder, or uses its own data when it has some', () => {
    expect(
      describeUserDataRelocation('resetToDefault', target({ kind: 'empty' }))
        .mode
    ).toBe('resetToDefault')
    expect(
      describeUserDataRelocation(
        'resetToDefault',
        target({ kind: 'occupied', subfolderPath: '/x' })
      ).mode
    ).toBe('resetToDefault')
    expect(
      describeUserDataRelocation(
        'resetToDefault',
        target({ kind: 'userData', formatVersion: 1, isSupported: true })
      )
    ).toMatchObject({
      mode: 'useDefault',
      notice: { messageKey: 'settings.userData.resetHasData' },
    })
    expect(
      describeUserDataRelocation('resetToDefault', target({ kind: 'current' }))
        .mode
    ).toBeNull()
  })
})
