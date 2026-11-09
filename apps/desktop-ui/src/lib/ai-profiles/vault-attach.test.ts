import { describe, expect, it, vi } from 'vitest'
import type { VaultFolder } from '@tyco/shared'

import { attachPickedVault } from './vault-attach'

function setup(folders: Record<string, VaultFolder['kind']>) {
  const deps = {
    pickFolder: vi.fn(async (): Promise<string | null> => '/picked'),
    inspect: vi.fn(async (path: string) => ({ path, kind: folders[path]! })),
    attach: vi.fn(async () => {}),
    askName: vi.fn(async (): Promise<string | null> => 'Work'),
    confirmSubfolder: vi.fn(async () => true),
    refuse: vi.fn(),
  }
  return deps
}

describe('attachPickedVault', () => {
  it('attaches a vault as it is', async () => {
    const deps = setup({ '/picked': { kind: 'vault', name: 'Work' } })
    expect(await attachPickedVault(deps)).toBe(true)
    expect(deps.attach).toHaveBeenCalledWith('/picked', '')
    expect(deps.askName).not.toHaveBeenCalled()
  })

  it('makes a named vault in an empty folder', async () => {
    const deps = setup({ '/picked': { kind: 'empty' } })
    expect(await attachPickedVault(deps)).toBe(true)
    expect(deps.attach).toHaveBeenCalledWith('/picked', 'Work')
  })

  it('offers a subfolder in a folder of other files', async () => {
    const deps = setup({
      '/picked': { kind: 'occupied', subfolder: '/picked/TyCo Vault' },
      '/picked/TyCo Vault': { kind: 'empty' },
    })
    expect(await attachPickedVault(deps)).toBe(true)
    expect(deps.attach).toHaveBeenCalledWith('/picked/TyCo Vault', 'Work')

    deps.confirmSubfolder.mockResolvedValueOnce(false)
    deps.attach.mockClear()
    expect(await attachPickedVault(deps)).toBe(false)
    expect(deps.attach).not.toHaveBeenCalled()
  })

  it('refuses a copy of a vault that is here and a nested folder', async () => {
    const copy = setup({ '/picked': { kind: 'duplicate' } })
    expect(await attachPickedVault(copy)).toBe(false)
    expect(copy.refuse).toHaveBeenCalledWith('duplicate', '/picked')
    const nested = setup({ '/picked': { kind: 'nested', message: 'inside' } })
    expect(await attachPickedVault(nested)).toBe(false)
    expect(nested.refuse).toHaveBeenCalledWith('nested', 'inside')
    expect(nested.attach).not.toHaveBeenCalled()
  })

  it('does nothing when no folder is picked', async () => {
    const deps = setup({})
    deps.pickFolder.mockResolvedValueOnce(null)
    expect(await attachPickedVault(deps)).toBe(false)
    expect(deps.inspect).not.toHaveBeenCalled()
  })
})
