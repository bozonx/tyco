import { describe, expect, it, vi } from 'vitest'
import type { AiProfile } from '@tyco/shared'
import { createAiProfilesModel } from './ai-profiles-model'

describe('ai-profiles-model', () => {
  const mockProfile: AiProfile = {
    id: 'tech-writer',
    name: 'Tech Writer',
    modelId: 'gpt-4o',
    projectPermissions: { 'docs-proj': { read: 'allow', write: 'ask' } },
    createdAt: 1000,
    updatedAt: 1000,
  }

  const createDeps = () => ({
    listProfiles: vi.fn().mockResolvedValue([mockProfile]),
    getProfile: vi.fn().mockResolvedValue(mockProfile),
    createProfile: vi.fn().mockResolvedValue(undefined),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    readSoul: vi.fn().mockResolvedValue('# Writer Prompt'),
    writeSoul: vi.fn().mockResolvedValue(undefined),
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
      expect.objectContaining({ name: 'Second' })
    )
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
      id: 'code-reviewer',
      name: 'Code Reviewer',
      projectPermissions: {},
      createdAt: 2000,
      updatedAt: 2000,
    })
    expect(deps.createProfile).toHaveBeenCalledWith(created, '# Reviewer')
    expect(model.profiles.value).toContainEqual(created)
  })

  it('gives a profile named in another script an id of its own', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)

    const created = await model.createProfile({ name: 'Писатель', soul: '' })

    expect(created.id).toBe('profile-abcd1234')
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

    expect(deps.saveProfile).toHaveBeenCalledWith({
      ...mockProfile,
      name: 'Senior',
      updatedAt: 2000,
    })
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
      expect.objectContaining({ name: 'Senior', temperature: 0.3 })
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

  it('sets a project permission', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    await model.setProjectPermission('tech-writer', 'new-proj', {
      read: 'deny',
      write: 'deny',
    })

    expect(deps.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPermissions: {
          'docs-proj': { read: 'allow', write: 'ask' },
          'new-proj': { read: 'deny', write: 'deny' },
        },
      })
    )
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

  it('reads and writes the root instruction', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)

    expect(await model.readSoul('tech-writer')).toBe('# Writer Prompt')
    await model.writeSoul('tech-writer', '# New')
    expect(deps.writeSoul).toHaveBeenCalledWith('tech-writer', '# New')
  })
})
