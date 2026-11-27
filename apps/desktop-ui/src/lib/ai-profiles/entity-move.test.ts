import type { WorkspaceInfo } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  moveTargets,
  profilesLosingProject,
  projectsLostByProfile,
} from './entity-move'

const workspace = (
  workspaceId: string,
  status: WorkspaceInfo['status'] = 'connected'
) => ({ workspaceId, isMain: !workspaceId, status }) as WorkspaceInfo

describe('entity move', () => {
  it('offers the other workspaces that are connected', () => {
    const workspaces = [
      workspace(''),
      workspace('w'),
      workspace('away', 'notConnected'),
    ]
    expect(
      moveTargets('profile-a', workspaces).map((v) => v.workspaceId)
    ).toEqual(['w'])
    expect(
      moveTargets('w:profile-a', workspaces).map((v) => v.workspaceId)
    ).toEqual([''])
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
