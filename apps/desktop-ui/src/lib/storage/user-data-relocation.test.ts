import { describe, expect, it } from 'vitest'
import type { UserDataTarget } from '@tyco/shared'

import { describeUserDataRelocation } from './user-data-relocation'

const target = (contents: UserDataTarget['contents']): UserDataTarget => ({
  path: '/sync/TyCo',
  isDefault: false,
  contents,
})

describe('describeUserDataRelocation', () => {
  it('moves into an empty folder or connects one with data when choosing, and only connects when restoring a missing folder', () => {
    expect(
      describeUserDataRelocation('choose', target({ kind: 'empty' }))
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
    expect(describeUserDataRelocation('choose', data)).toMatchObject({
      mode: 'connect',
      notice: { kind: 'warning' },
    })
    expect(describeUserDataRelocation('connect', data)).toMatchObject({
      mode: 'connect',
      notice: { kind: 'warning' },
    })
  })

  it('refuses a folder of a newer layout, an unfinished sync, current and app folders', () => {
    for (const action of ['choose', 'connect'] as const) {
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
        describeUserDataRelocation(action, target({ kind: 'current' }))
      ).toMatchObject({
        mode: null,
        notice: { kind: 'info', messageKey: 'settings.userData.targetCurrent' },
      })
      expect(
        describeUserDataRelocation(action, target({ kind: 'forbidden' }))
      ).toMatchObject({ mode: null, notice: { kind: 'error' } })
    }
  })

  it('offers a subfolder of a folder holding other files', () => {
    expect(
      describeUserDataRelocation(
        'choose',
        target({ kind: 'occupied', subfolderPath: '/docs/TyCo' })
      )
    ).toMatchObject({ mode: null, subfolderPath: '/docs/TyCo' })
  })
})
