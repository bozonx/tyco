import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFolder } from '@tyco/shared'

import { attachPickedWorkspace } from './workspace-attach'

function setup(folders: Record<string, WorkspaceFolder['kind']>) {
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

describe('attachPickedWorkspace', () => {
  it('attaches a workspace as it is', async () => {
    const deps = setup({ '/picked': { kind: 'workspace', name: 'Work' } })
    expect(await attachPickedWorkspace(deps)).toBe(true)
    expect(deps.attach).toHaveBeenCalledWith('/picked', '')
    expect(deps.askName).not.toHaveBeenCalled()
  })

  it('makes a named workspace in an empty folder', async () => {
    const deps = setup({ '/picked': { kind: 'empty' } })
    expect(await attachPickedWorkspace(deps)).toBe(true)
    expect(deps.attach).toHaveBeenCalledWith('/picked', 'Work')
  })

  it('offers a subfolder in a folder of other files', async () => {
    const deps = setup({
      '/picked': { kind: 'occupied', subfolder: '/picked/TyCo Workspace' },
      '/picked/TyCo Workspace': { kind: 'empty' },
    })
    expect(await attachPickedWorkspace(deps)).toBe(true)
    expect(deps.attach).toHaveBeenCalledWith('/picked/TyCo Workspace', 'Work')

    deps.confirmSubfolder.mockResolvedValueOnce(false)
    deps.attach.mockClear()
    expect(await attachPickedWorkspace(deps)).toBe(false)
    expect(deps.attach).not.toHaveBeenCalled()
  })

  it('refuses a copy of a workspace that is here and a nested folder', async () => {
    const copy = setup({ '/picked': { kind: 'duplicate' } })
    expect(await attachPickedWorkspace(copy)).toBe(false)
    expect(copy.refuse).toHaveBeenCalledWith('duplicate', '/picked')
    const nested = setup({ '/picked': { kind: 'nested', message: 'inside' } })
    expect(await attachPickedWorkspace(nested)).toBe(false)
    expect(nested.refuse).toHaveBeenCalledWith('nested', 'inside')
    expect(nested.attach).not.toHaveBeenCalled()
  })

  it('does nothing when no folder is picked', async () => {
    const deps = setup({})
    deps.pickFolder.mockResolvedValueOnce(null)
    expect(await attachPickedWorkspace(deps)).toBe(false)
    expect(deps.inspect).not.toHaveBeenCalled()
  })
})
