import { describe, expect, it, vi } from 'vitest'
import type { UserDataTarget } from '@tyco/shared'

import {
  createUserDataFolderModel,
  type UserDataFolderDependencies,
} from './user-data-folder-model'

const empty: UserDataTarget = {
  path: '/sync/TyCo',
  isDefault: false,
  contents: { kind: 'empty' },
}

function fixture(overrides: Partial<UserDataFolderDependencies> = {}) {
  const deps: UserDataFolderDependencies = {
    inspect: vi.fn().mockResolvedValue(empty),
    relocate: vi.fn().mockResolvedValue(undefined),
    flushDrafts: vi.fn().mockResolvedValue(true),
    pickFolder: vi.fn().mockResolvedValue('/sync/TyCo'),
    describeError: (error) => String(error),
    draftsNotSavedMessage: () => 'Drafts not saved',
    ...overrides,
  }
  return { deps, model: createUserDataFolderModel(deps) }
}

describe('createUserDataFolderModel', () => {
  it('picks a folder at once and moves the data into an empty folder after saving drafts', async () => {
    const { deps, model } = fixture()
    await model.start('choose')
    expect(deps.pickFolder).toHaveBeenCalledOnce()
    expect(model.relocation.value?.mode).toBe('move')
    expect(await model.apply()).toBe(true)
    expect(deps.flushDrafts).toHaveBeenCalledBefore(deps.relocate as never)
    expect(deps.relocate).toHaveBeenCalledWith('move', '/sync/TyCo')
  })

  it('stays closed when the folder picker is cancelled', async () => {
    const { deps, model } = fixture({
      pickFolder: vi.fn().mockResolvedValue(null),
    })
    await model.start('choose')
    expect(model.action.value).toBeNull()
    expect(deps.inspect).not.toHaveBeenCalled()
  })

  it('connects an existing user data folder when chosen', async () => {
    const { deps, model } = fixture({
      inspect: vi
        .fn()
        .mockResolvedValue({
          path: '/sync/TyCo',
          isDefault: false,
          contents: { kind: 'userData', formatVersion: 1, isSupported: true },
        }),
    })
    await model.start('choose')
    expect(model.relocation.value?.mode).toBe('connect')
    expect(await model.apply()).toBe(true)
    expect(deps.relocate).toHaveBeenCalledWith('connect', '/sync/TyCo')
  })

  it('changes nothing when a draft could not be saved', async () => {
    const { deps, model } = fixture({
      flushDrafts: vi.fn().mockResolvedValue(false),
    })
    await model.start('choose')
    expect(await model.apply()).toBe(false)
    expect(deps.relocate).not.toHaveBeenCalled()
    expect(model.errorMessage.value).toBe('Drafts not saved')
  })

  it('applies nothing a folder cannot take and reports a failure', async () => {
    const { deps, model } = fixture()
    await model.start('connect')
    expect(model.relocation.value?.mode).toBeNull()
    expect(await model.apply()).toBe(false)
    expect(deps.relocate).not.toHaveBeenCalled()

    const failing = fixture({
      relocate: vi.fn().mockRejectedValue('Disk full'),
    })
    await failing.model.start('choose')
    expect(await failing.model.apply()).toBe(false)
    expect(failing.model.errorMessage.value).toBe('Disk full')
  })

  it('inspects the offered subfolder', async () => {
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({
        ...empty,
        path: '/docs',
        contents: { kind: 'occupied', subfolderPath: '/docs/TyCo' },
      })
      .mockResolvedValueOnce(empty)
    const { model } = fixture({ inspect })
    await model.start('choose')
    await model.useSubfolder()
    expect(inspect).toHaveBeenLastCalledWith('/docs/TyCo')
    expect(model.relocation.value?.mode).toBe('move')
  })
})
