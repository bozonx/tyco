import type { VaultInfo } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  moveTargets,
  profilesLosingProject,
  projectsLostByProfile,
} from './entity-move'

const vault = (vaultId: string, status: VaultInfo['status'] = 'connected') =>
  ({ vaultId, isMain: !vaultId, status }) as VaultInfo

describe('entity move', () => {
  it('offers the other workspaces that are connected', () => {
    const vaults = [vault(''), vault('w'), vault('away', 'notConnected')]
    expect(moveTargets('profile-a', vaults).map((v) => v.vaultId)).toEqual([
      'w',
    ])
    expect(moveTargets('w:profile-a', vaults).map((v) => v.vaultId)).toEqual([
      '',
    ])
  })

  it('lists the access a move takes away: by default every project', () => {
    const projects = [
      { id: 'project-a', name: 'A' },
      { id: 'project-b', name: 'B' },
      { id: 'w:project-c', name: 'C' },
    ]
    const profile = {
      id: 'profile-x',
      name: 'X',
      projectPermissions: {
        'project-a': { read: 'deny', write: 'deny', delete: 'deny' },
      } as const,
    }
    expect(projectsLostByProfile(profile, projects)).toEqual(['B'])
    expect(profilesLosingProject('project-b', [profile])).toEqual(['X'])
    expect(profilesLosingProject('project-a', [profile])).toEqual([])
    // a project of another workspace was never in reach
    expect(profilesLosingProject('w:project-c', [profile])).toEqual([])
  })
})
