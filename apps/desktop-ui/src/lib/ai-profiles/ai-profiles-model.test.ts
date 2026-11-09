import { describe, expect, it, vi } from 'vitest'
import type { AiProfile } from '@tyco/shared'
import { createAiProfilesModel } from './ai-profiles-model'
import { IpcCallError } from '../ipc/ipc-model'

describe('ai-profiles-model', () => {
  const mockProfile: AiProfile = {
    id: 'tech-writer',
    name: 'Tech Writer',
    memoryMode: 'auto',
    modelId: 'gpt-4o',
    projectPermissions: { 'docs-proj': { read: 'allow', write: 'ask' } },
    createdAt: 1000,
    updatedAt: 1000,
  }

  const createDeps = () => ({
    listProfiles: vi.fn().mockResolvedValue([mockProfile]),
    getProfile: vi.fn().mockResolvedValue(mockProfile),
    createProfile: vi.fn().mockResolvedValue(undefined),
    saveProfile: vi.fn().mockResolvedValue('r2'),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    readSoul: vi
      .fn()
      .mockResolvedValue({ content: '# Writer Prompt', revision: 's1' }),
    now: vi.fn().mockReturnValue(2000),
    randomSuffix: () => 'abcd1234',
  })

  it('reports failed writes without breaking later saves', async () => {
    const deps = { ...createDeps(), reportError: vi.fn() }
    const error = new Error('disk full')
    deps.saveProfile.mockRejectedValueOnce(error)
    const model = createAiProfilesModel(deps)
    await model.loadProfiles()
    await expect(
      model.updateProfile('tech-writer', { name: 'First' })
    ).rejects.toThrow('disk full')
    expect(deps.reportError).toHaveBeenCalledWith(error)
    await model.updateProfile('tech-writer', { name: 'Second' })
    expect(deps.saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Second' }),
      undefined
    )
  })

  it('ignores older list responses and invalidated loads', async () => {
    const deps = createDeps()
    let resolveOld!: (items: never[]) => void
    deps.listProfiles.mockImplementationOnce(
      () =>
        new Promise<never[]>((resolve) => {
          resolveOld = resolve
        })
    )
    const model = createAiProfilesModel(deps)
    const oldLoad = model.loadProfiles()
    await model.loadProfiles()
    const current = model.profiles.value
    resolveOld([])
    await oldLoad
    expect(model.profiles.value).toBe(current)
    deps.listProfiles.mockResolvedValue([])
    await model.loadProfiles(() => false)
    expect(model.profiles.value).toBe(current)
  })

  it.each(['create', 'update', 'delete'] as const)(
    'keeps a %s over an older list response',
    async (operation) => {
      const deps = createDeps()
      const model = createAiProfilesModel(deps)
      await model.loadProfiles()
      let resolveList!: (items: AiProfile[]) => void
      deps.listProfiles.mockImplementationOnce(
        () =>
          new Promise<AiProfile[]>((resolve) => {
            resolveList = resolve
          })
      )
      const load = model.loadProfiles()
      if (operation === 'create') {
        await model.createProfile({ name: 'New', soul: '' })
      } else if (operation === 'update') {
        await model.updateProfile('tech-writer', { name: 'Updated' })
      } else {
        await model.deleteProfile('tech-writer')
      }
      resolveList([mockProfile])
      await load
      if (operation === 'create')
        expect(model.profiles.value.map((item) => item.name)).toContain('New')
      else if (operation === 'update')
        expect(model.getProfile('tech-writer')?.name).toBe('Updated')
      else expect(model.profiles.value).toEqual([])
    }
  )

  it('does not apply a list read during creation', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    await model.loadProfiles()
    let finishCreate!: () => void
    deps.createProfile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve
        })
    )
    const creating = model.createProfile({ name: 'New', soul: '' })
    const created = { ...mockProfile, id: 'profile-abcd1234', name: 'New' }
    let resolveList!: (items: AiProfile[]) => void
    deps.listProfiles.mockImplementationOnce(
      () =>
        new Promise<AiProfile[]>((resolve) => {
          resolveList = resolve
        })
    )
    const loading = model.loadProfiles()
    resolveList([mockProfile, created])
    await loading
    finishCreate()
    await creating
    expect(
      model.profiles.value.filter((item) => item.id === 'profile-abcd1234')
    ).toHaveLength(1)
  })

  it('allows loading again after a failed mutation', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    deps.deleteProfile.mockRejectedValueOnce(new Error('disk error'))
    await expect(model.deleteProfile('tech-writer')).rejects.toThrow(
      'disk error'
    )
    await model.loadProfiles()
    expect(model.profiles.value).toEqual([mockProfile])
  })

  it('loads profiles into state', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    await model.loadProfiles()

    expect(deps.listProfiles).toHaveBeenCalledOnce()
    expect(model.profiles.value).toEqual([mockProfile])
    expect(model.getProfile('tech-writer')).toEqual(mockProfile)
  })

  it('creates a profile with its root instruction', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    const created = await model.createProfile({
      name: ' Code Reviewer ',
      soul: '# Reviewer',
    })

    expect(created).toEqual({
      id: 'profile-abcd1234',
      name: 'Code Reviewer',
      memoryMode: 'auto',
      projectPermissions: {},
      createdAt: 2000,
      updatedAt: 2000,
    })
    expect(deps.createProfile).toHaveBeenCalledWith(created, '# Reviewer')
    expect(model.profiles.value).toContainEqual(created)
  })

  it('gives two profiles of one name different folders', async () => {
    const deps = createDeps()
    let suffix = 0
    const model = createAiProfilesModel({
      ...deps,
      randomSuffix: () => `0000000${++suffix}`,
    })

    const first = await model.createProfile({ name: 'Assistant', soul: '' })
    const second = await model.createProfile({ name: 'Assistant', soul: '' })
    expect(first.id).toBe('profile-00000001')
    expect(second.id).toBe('profile-00000002')
  })

  it('takes another id when the folder is there already', async () => {
    const deps = createDeps()
    deps.createProfile.mockRejectedValueOnce(
      new IpcCallError('Profile already exists', 'alreadyExists')
    )
    let suffix = 0
    const model = createAiProfilesModel({
      ...deps,
      randomSuffix: () => `0000000${++suffix}`,
    })

    const created = await model.createProfile({ name: 'Writer', soul: '' })
    expect(created.id).toBe('profile-00000002')
    expect(deps.createProfile).toHaveBeenCalledTimes(2)
    expect(model.profiles.value.map(({ id }) => id)).toEqual([
      'profile-00000002',
    ])
  })

  it('keeps a profile out of the state when it cannot be created', async () => {
    const deps = createDeps()
    deps.createProfile.mockRejectedValue(new Error('exists'))
    const model = createAiProfilesModel(deps)

    await expect(
      model.createProfile({ name: 'Writer', soul: '' })
    ).rejects.toThrow('exists')
    expect(model.profiles.value).toEqual([])
  })

  it('applies a change at once and stores it with a new timestamp', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    const saved = model.updateProfile('tech-writer', { name: 'Senior' })
    expect(model.getProfile('tech-writer')?.name).toBe('Senior')
    await saved

    expect(deps.saveProfile).toHaveBeenCalledWith(
      { ...mockProfile, name: 'Senior', updatedAt: 2000 },
      undefined
    )
    expect(model.getProfile('tech-writer')?.revision).toBe('r2')
  })

  it('stores quick changes one after another without losing any', async () => {
    const deps = createDeps()
    let release!: () => void
    deps.saveProfile.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    )
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    const first = model.updateProfile('tech-writer', { name: 'Senior' })
    const second = model.updateProfile('tech-writer', { temperature: 0.3 })
    await vi.waitFor(() => expect(deps.saveProfile).toHaveBeenCalledOnce())
    release()
    await Promise.all([first, second])

    expect(deps.saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Senior', temperature: 0.3 }),
      undefined
    )
  })

  it('removes a setting that is cleared', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    await model.updateProfile('tech-writer', { modelId: undefined })

    expect(
      JSON.parse(JSON.stringify(model.getProfile('tech-writer')))
    ).not.toHaveProperty('modelId')
  })

  it('keeps a completed edit over an earlier profile refresh', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    await model.loadProfiles()
    let resolveRead!: (profile: AiProfile) => void
    deps.getProfile.mockImplementationOnce(
      () =>
        new Promise<AiProfile>((resolve) => {
          resolveRead = resolve
        })
    )
    const refresh = model.refreshProfile('tech-writer')
    await model.updateProfile('tech-writer', { name: 'Saved edit' })
    resolveRead(mockProfile)
    expect((await refresh)?.name).toBe('Saved edit')
    expect(model.getProfile('tech-writer')?.name).toBe('Saved edit')
    await model.updateProfile('tech-writer', { temperature: 0.7 })
    expect(deps.saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Saved edit', temperature: 0.7 }),
      'r2'
    )
  })

  it('keeps the latest refresh when reads finish out of order', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    await model.loadProfiles()
    let resolveRead!: (profile: AiProfile) => void
    deps.getProfile.mockImplementationOnce(
      () =>
        new Promise<AiProfile>((resolve) => {
          resolveRead = resolve
        })
    )
    const oldRefresh = model.refreshProfile('tech-writer')
    deps.getProfile.mockResolvedValueOnce({ ...mockProfile, name: 'Latest' })
    await model.refreshProfile('tech-writer')
    resolveRead(mockProfile)
    await oldRefresh
    expect(model.getProfile('tech-writer')?.name).toBe('Latest')
  })

  it('reads a profile edited on disk', async () => {
    const deps = createDeps()
    deps.getProfile.mockResolvedValue({ ...mockProfile, temperature: 1.2 })
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    const refreshed = await model.refreshProfile('tech-writer')

    expect(refreshed?.temperature).toBe(1.2)
    expect(model.getProfile('tech-writer')?.temperature).toBe(1.2)
  })

  it('keeps a change not stored yet over the profile on disk', async () => {
    const deps = createDeps()
    deps.saveProfile.mockImplementation(() => new Promise<void>(() => {}))
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    void model.updateProfile('tech-writer', { name: 'Senior' })
    await model.refreshProfile('tech-writer')

    expect(deps.getProfile).not.toHaveBeenCalled()
    expect(model.getProfile('tech-writer')?.name).toBe('Senior')
  })

  it('connects and disconnects a project', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    await model.setProjectAccess('tech-writer', 'new-proj', 'full')
    expect(deps.saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectPermissions: {
          'docs-proj': { read: 'allow', write: 'ask' },
          'new-proj': { read: 'allow', write: 'allow' },
        },
      }),
      undefined
    )

    await model.setProjectAccess('tech-writer', 'docs-proj', undefined)
    expect(deps.saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectPermissions: { 'new-proj': { read: 'allow', write: 'allow' } },
      }),
      'r2'
    )
  })

  it('duplicates the settings and root instruction of a profile', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    await model.loadProfiles()
    await model.updateProfile('tech-writer', {
      temperature: 0.3,
      tools: { groups: { files: { isEnabled: true, access: 'ask' } } },
    })

    const copy = await model.duplicateProfile('tech-writer', 'Tech Writer 2')

    expect(deps.readSoul).toHaveBeenCalledWith('tech-writer')
    expect(copy).toEqual({
      id: 'profile-abcd1234',
      name: 'Tech Writer 2',
      memoryMode: 'auto',
      modelId: 'gpt-4o',
      temperature: 0.3,
      projectPermissions: mockProfile.projectPermissions,
      tools: { groups: { files: { isEnabled: true, access: 'ask' } } },
      createdAt: 2000,
      updatedAt: 2000,
    })
    expect(deps.createProfile).toHaveBeenCalledWith(copy, '# Writer Prompt')
    // the copy does not share state with the original
    copy.projectPermissions['docs-proj']!.write = 'deny'
    expect(
      model.getProfile('tech-writer')?.projectPermissions['docs-proj']?.write
    ).toBe('ask')
  })

  it('deletes a profile after its pending write', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    void model.updateProfile('tech-writer', { name: 'Senior' })
    await model.deleteProfile('tech-writer')

    expect(deps.saveProfile.mock.invocationCallOrder[0]).toBeLessThan(
      deps.deleteProfile.mock.invocationCallOrder[0]
    )
    expect(model.profiles.value).toEqual([])
  })

  it('reads the root instruction', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    expect(await model.readSoul('tech-writer')).toBe('# Writer Prompt')
  })

  it('saves with the revision it read and keeps the new one', async () => {
    const deps = createDeps()
    deps.saveProfile.mockResolvedValueOnce('r2').mockResolvedValueOnce('r3')
    const model = createAiProfilesModel(deps)
    model.profiles.value = [{ ...mockProfile, revision: 'r1' }]

    await model.updateProfile('tech-writer', { name: 'First' })
    await model.updateProfile('tech-writer', { name: 'Second' })
    expect(deps.saveProfile.mock.calls.map(([, revision]) => revision)).toEqual(
      ['r1', 'r2']
    )
    // the revision is never stored in the file
    expect(deps.saveProfile.mock.calls[0]![0]).not.toHaveProperty('revision')
    expect(model.getProfile('tech-writer')?.revision).toBe('r3')
  })

  it('keeps a profile changed elsewhere for the user to decide', async () => {
    const deps = { ...createDeps(), reportError: vi.fn() }
    deps.saveProfile.mockRejectedValueOnce(
      new IpcCallError('changed', 'staleRevision')
    )
    const model = createAiProfilesModel(deps)
    model.profiles.value = [{ ...mockProfile, revision: 'r1' }]

    await expect(
      model.updateProfile('tech-writer', { name: 'Mine' })
    ).rejects.toThrow('changed')
    expect(deps.reportError).not.toHaveBeenCalled()
    expect(model.conflicts.value['tech-writer']?.name).toBe('Mine')
    // a reload of the list keeps what was not stored
    await model.loadProfiles()
    expect(model.getProfile('tech-writer')?.name).toBe('Mine')

    // save mine: over the revision on disk now
    deps.getProfile.mockResolvedValueOnce({
      ...mockProfile,
      name: 'Remote',
      revision: 'remote',
    })
    await model.resolveConflict('tech-writer', true)
    expect(deps.saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Mine' }),
      'remote'
    )
    expect(model.conflicts.value).toEqual({})
  })

  it('rereads a profile changed elsewhere', async () => {
    const deps = createDeps()
    deps.saveProfile.mockRejectedValueOnce(
      new IpcCallError('changed', 'staleRevision')
    )
    const model = createAiProfilesModel(deps)
    model.profiles.value = [{ ...mockProfile, revision: 'r1' }]
    await model.updateProfile('tech-writer', { name: 'Mine' }).catch(() => {})

    const remote = { ...mockProfile, name: 'Remote', revision: 'remote' }
    deps.getProfile.mockResolvedValueOnce(remote)
    await model.resolveConflict('tech-writer', false)
    expect(model.getProfile('tech-writer')).toEqual(remote)
    expect(deps.saveProfile).toHaveBeenCalledOnce()
  })
})
