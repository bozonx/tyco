import { describe, expect, it, vi } from 'vitest'
import type { AiProfile } from '@tyco/shared'
import { createAiProfilesModel } from './ai-profiles-model'

describe('ai-profiles-model', () => {
  const mockProfile: AiProfile = {
    id: 'tech-writer',
    name: 'Tech Writer',
    icon: 'mdi:feather',
    lastModelId: 'gpt-4o',
    projectPermissions: { 'docs-proj': { read: 'allow', write: 'ask' } },
    createdAt: 1000,
    updatedAt: 1000,
  }

  const createDeps = () => ({
    listProfiles: vi.fn().mockResolvedValue([mockProfile]),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    readSoul: vi.fn().mockResolvedValue('# Writer Prompt'),
    writeSoul: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(2000),
  })

  it('loads profiles into state', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    await model.loadProfiles()

    expect(deps.listProfiles).toHaveBeenCalledOnce()
    expect(model.profiles.value).toEqual([mockProfile])
    expect(model.getProfile('tech-writer')).toEqual(mockProfile)
  })

  it('creates a new profile with generated or provided id and updates state', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    const created = await model.createProfile({
      name: 'Code Reviewer',
      icon: 'mdi:code-tags',
    })

    expect(created.id).toBe('code-reviewer')
    expect(created.name).toBe('Code Reviewer')
    expect(created.createdAt).toBe(2000)
    expect(deps.saveProfile).toHaveBeenCalledWith(created)
    expect(model.profiles.value).toContainEqual(created)
  })

  it('updates an existing profile with updated timestamp', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    await model.saveProfile({ ...mockProfile, name: 'Senior Tech Writer' })

    expect(deps.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Senior Tech Writer', updatedAt: 2000 })
    )
    expect(model.getProfile('tech-writer')?.name).toBe('Senior Tech Writer')
  })

  it('deletes a profile and removes it from state', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    await model.deleteProfile('tech-writer')
    expect(deps.deleteProfile).toHaveBeenCalledWith('tech-writer')
    expect(model.profiles.value).toEqual([])
  })

  it('updates last used model for a profile', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)
    model.profiles.value = [mockProfile]

    await model.updateLastModel('tech-writer', 'claude-3-5-sonnet')
    expect(deps.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tech-writer',
        lastModelId: 'claude-3-5-sonnet',
      })
    )
  })

  it('sets project permission for a profile', async () => {
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

  it('reads and writes soul prompt', async () => {
    const deps = createDeps()
    const model = createAiProfilesModel(deps)

    const soul = await model.readSoul('tech-writer')
    expect(soul).toBe('# Writer Prompt')
    expect(deps.readSoul).toHaveBeenCalledWith('tech-writer')

    await model.writeSoul('tech-writer', '# New Persona')
    expect(deps.writeSoul).toHaveBeenCalledWith('tech-writer', '# New Persona')
  })
})
