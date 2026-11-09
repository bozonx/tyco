import { describe, expect, it } from 'vitest'
import type { VaultInfo } from '@tyco/shared'

import { entityLabel, groupByVault, vaultLabel } from './vault-groups'

const vault = (patch: Partial<VaultInfo>): VaultInfo => ({
  vaultId: '',
  name: '',
  path: '/data/ai-vault',
  isMain: true,
  status: 'connected',
  isWritableByOthers: false,
  ...patch,
})

const main = vault({})
const work = vault({ vaultId: 'w1', name: 'Work', path: '/w', isMain: false })
const away = vault({
  vaultId: 'w2',
  path: '/mnt/usb/Vault',
  isMain: false,
  status: 'notConnected',
})

describe('vault groups', () => {
  it('group entities by the vault of their reference', () => {
    const groups = groupByVault(
      [
        { id: 'a', name: 'A' },
        { id: 'w1:b', name: 'B' },
      ],
      [main, work, away]
    )
    expect(groups.map(({ vault, items }) => [vault.vaultId, items])).toEqual([
      ['', [{ id: 'a', name: 'A' }]],
      ['w1', [{ id: 'w1:b', name: 'B' }]],
    ])
  })

  it('name the vault only when profile names clash', () => {
    const profiles = [
      { id: 'a', name: 'Assistant' },
      { id: 'w1:b', name: 'Assistant' },
      { id: 'w1:c', name: 'Coder' },
    ]
    const label = (item: (typeof profiles)[number]) =>
      entityLabel(item, profiles, [main, work], 'Main')
    expect(profiles.map(label)).toEqual([
      'Assistant (Main)',
      'Assistant (Work)',
      'Coder',
    ])
    expect(vaultLabel(away, 'Main')).toBe('Vault')
  })
})
