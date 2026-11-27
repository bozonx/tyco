import type { ProjectPermission, WorkspaceInfo } from '@tyco/shared'

import { effectiveProjectAccessLevel } from './project-access'
import { workspaceOfRef } from './profile-ref'

interface Named {
  readonly id: string
  readonly name: string
}

interface WithPermissions extends Named {
  readonly projectPermissions: Readonly<Record<string, ProjectPermission>>
}

/** The workspaces an entity (a reference `[workspaceId:]id`) can move to now */
export const moveTargets = (
  entityId: string,
  workspaces: readonly WorkspaceInfo[]
): WorkspaceInfo[] =>
  workspaces.filter(
    (workspace) =>
      (workspace.isMain || workspace.status === 'connected') &&
      workspace.workspaceId !== workspaceOfRef(entityId)
  )

/**
 * The projects a moved profile loses its access to: all of its workspace it may
 * use now
 */
export const projectsLostByProfile = (
  profile: WithPermissions,
  projects: readonly Named[]
): string[] =>
  projects
    .filter(
      (project) =>
        workspaceOfRef(project.id) === workspaceOfRef(profile.id) &&
        effectiveProjectAccessLevel(profile.projectPermissions, project.id)
    )
    .map((project) => project.name)

/** The profiles that lose their access to a moved project */
export const profilesLosingProject = (
  projectId: string,
  profiles: readonly WithPermissions[]
): string[] =>
  profiles
    .filter(
      (profile) =>
        workspaceOfRef(profile.id) === workspaceOfRef(projectId) &&
        effectiveProjectAccessLevel(profile.projectPermissions, projectId)
    )
    .map((profile) => profile.name)
