import type { ProjectPermission, VaultInfo } from '@tyco/shared'

import { effectiveProjectAccessLevel } from './project-access'
import { vaultOfRef } from './profile-ref'

interface Named {
  readonly id: string
  readonly name: string
}

interface WithPermissions extends Named {
  readonly projectPermissions: Readonly<Record<string, ProjectPermission>>
}

/** The workspaces an entity (a reference `[vaultId:]id`) can move to now */
export const moveTargets = (
  entityId: string,
  vaults: readonly VaultInfo[]
): VaultInfo[] =>
  vaults.filter(
    (vault) =>
      (vault.isMain || vault.status === 'connected') &&
      vault.vaultId !== vaultOfRef(entityId)
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
        vaultOfRef(project.id) === vaultOfRef(profile.id) &&
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
        vaultOfRef(profile.id) === vaultOfRef(projectId) &&
        effectiveProjectAccessLevel(profile.projectPermissions, projectId)
    )
    .map((profile) => profile.name)
