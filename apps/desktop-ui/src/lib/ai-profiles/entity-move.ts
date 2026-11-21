import type { VaultInfo } from '@tyco/shared'

import { vaultOfRef } from './profile-ref'

interface Named {
  readonly id: string
  readonly name: string
}

interface WithPermissions extends Named {
  readonly projectPermissions: Readonly<Record<string, unknown>>
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

/** The projects a moved profile loses its access to: all it may use now */
export const projectsLostByProfile = (
  profile: WithPermissions,
  projects: readonly Named[]
): string[] =>
  projects
    .filter((project) => project.id in profile.projectPermissions)
    .map((project) => project.name)

/** The profiles that lose their access to a moved project */
export const profilesLosingProject = (
  projectId: string,
  profiles: readonly WithPermissions[]
): string[] =>
  profiles
    .filter((profile) => projectId in profile.projectPermissions)
    .map((profile) => profile.name)
