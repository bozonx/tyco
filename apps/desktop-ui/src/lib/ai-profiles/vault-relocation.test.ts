import { describe, expect, it } from 'vitest'
import type { VaultTarget } from '@tyco/shared'

import { describeVaultRelocation } from './vault-relocation'

const target = (contents: VaultTarget['contents']): VaultTarget => ({
  path: '/vault',
  isDefault: false,
  contents,
})

describe('describeVaultRelocation', () => {
  it('moves the current vault into an empty folder when asked', () => {
    const moving = describeVaultRelocation(target({ kind: 'empty' }), {
      hasCurrentData: true,
      wantsMove: true,
    })
    expect(moving).toMatchObject({
      canApply: true,
      canMove: true,
      isMoving: true,
      notice: { messageKey: 'settings.vaultTargetEmptyMove' },
    })

    const fresh = describeVaultRelocation(target({ kind: 'empty' }), {
      hasCurrentData: true,
      wantsMove: false,
    })
    expect(fresh).toMatchObject({
      isMoving: false,
      notice: { kind: 'warning', messageKey: 'settings.vaultTargetEmptyFresh' },
    })
  })

  it('has nothing to move from an empty vault', () => {
    const result = describeVaultRelocation(target({ kind: 'empty' }), {
      hasCurrentData: false,
      wantsMove: true,
    })
    expect(result).toMatchObject({
      canApply: true,
      canMove: false,
      isMoving: false,
      notice: { kind: 'info' },
    })
  })

  it('uses another vault as it is', () => {
    const result = describeVaultRelocation(
      target({ kind: 'vault', profileCount: 2, projectCount: 1 }),
      { hasCurrentData: true, wantsMove: true }
    )
    expect(result).toMatchObject({
      canApply: true,
      canMove: false,
      isMoving: false,
      notice: { params: { profiles: 2, projects: 1 } },
    })
  })

  it('offers a subfolder for a folder with files of its own', () => {
    const result = describeVaultRelocation(
      target({ kind: 'occupied', subfolderPath: '/docs/tyco-vault' }),
      { hasCurrentData: true, wantsMove: true }
    )
    expect(result).toMatchObject({
      canApply: false,
      subfolderPath: '/docs/tyco-vault',
    })
  })

  it('refuses the current folder and folders around it', () => {
    for (const kind of ['current', 'nested'] as const) {
      expect(
        describeVaultRelocation(target({ kind }), {
          hasCurrentData: true,
          wantsMove: true,
        }).canApply
      ).toBe(false)
    }
  })
})
