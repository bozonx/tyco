import type { ProjectAccessMode, ProjectPermission } from '@tyco/shared'

import { stricterAccess } from '../chat-tools/chat-tool-policy'

/** A level the settings offer for a project a profile is connected to */
export type SelectableProjectAccessLevel = 'read' | 'readWrite' | 'full'

/**
 * How far a profile may go in a project it is connected to; `custom` for
 * permissions edited by hand that match no level, kept as they are
 */
export type ProjectAccessLevel = SelectableProjectAccessLevel | 'custom'

export const PROJECT_ACCESS_LEVELS: readonly SelectableProjectAccessLevel[] = [
  'read',
  'readWrite',
  'full',
]

export const PROJECT_ACCESS_LABEL_KEYS: Record<ProjectAccessLevel, string> = {
  read: 'settings.accessLevelRead',
  readWrite: 'settings.accessLevelReadWrite',
  full: 'settings.accessLevelFull',
  custom: 'settings.accessLevelCustom',
}

/**
 * The level a profile has in every project of its workspace until the user
 * changes it: reading without asking, changes with confirmation
 */
export const DEFAULT_PROJECT_ACCESS_LEVEL: SelectableProjectAccessLevel =
  'readWrite'

const PERMISSIONS: Record<SelectableProjectAccessLevel, ProjectPermission> = {
  read: { read: 'allow', write: 'deny', delete: 'deny' },
  readWrite: { read: 'allow', write: 'ask', delete: 'ask' },
  full: { read: 'allow', write: 'allow', delete: 'ask' },
}

/**
 * The permissions of a level; deleting without asking is offered only where
 * writing does not ask
 */
export function projectPermissionFor(
  level: SelectableProjectAccessLevel,
  isDeleteAllowed = false
): ProjectPermission {
  const permission = { ...PERMISSIONS[level] }
  return isDeleteAllowed && permission.write === 'allow'
    ? { ...permission, delete: 'allow' }
    : permission
}

/** What a profile stores for a project it has no access to */
export const NO_PROJECT_ACCESS: ProjectPermission = {
  read: 'deny',
  write: 'deny',
  delete: 'deny',
}

/**
 * The permission a profile has in a project: the stored one, or the default
 * level when the profile stores none
 */
export function effectiveProjectPermission(
  permissions: Readonly<Record<string, ProjectPermission>> | undefined,
  projectId: string
): ProjectPermission {
  return (
    permissions?.[projectId] ??
    projectPermissionFor(DEFAULT_PROJECT_ACCESS_LEVEL)
  )
}

/** The level a profile has in a project; undefined when it has no access */
export const effectiveProjectAccessLevel = (
  permissions: Readonly<Record<string, ProjectPermission>> | undefined,
  projectId: string
): ProjectAccessLevel | undefined =>
  projectAccessLevelOf(effectiveProjectPermission(permissions, projectId))

/** The permissions with deleting no freer than writing, as Rust applies them */
export function normalizedProjectPermission(
  permission: ProjectPermission
): ProjectPermission {
  return {
    ...permission,
    delete: stricterAccess(permission.write, permission.delete),
  }
}

/** Whether the profile deletes in the project without asking */
export const isDeleteAllowed = (permission: ProjectPermission | undefined) =>
  permission?.write === 'allow' && permission.delete === 'allow'

/**
 * The level of a stored permission; `undefined` when the profile is not
 * connected to the project, `custom` when it matches no level: shown as such,
 * never as a level that would let do more or less than it does
 */
export function projectAccessLevelOf(
  permission: ProjectPermission | undefined
): ProjectAccessLevel | undefined {
  if (!permission) return undefined
  if (permission.read === 'deny' && permission.write === 'deny')
    return undefined
  const level = PROJECT_ACCESS_LEVELS.find((candidate) => {
    const preset = PERMISSIONS[candidate]
    return (
      preset.read === permission.read &&
      preset.write === permission.write &&
      (preset.delete === permission.delete ||
        (candidate === 'full' && permission.delete === 'allow'))
    )
  })
  return level ?? 'custom'
}

/**
 * The permissions with one project at `level`, or without access to it. The
 * default level is stored as no entry, so it follows the default
 */
export function withProjectAccess(
  permissions: Readonly<Record<string, ProjectPermission>>,
  projectId: string,
  level: ProjectAccessLevel | undefined
): Record<string, ProjectPermission> {
  // a custom permission stays as it is
  if (level === 'custom') return { ...permissions }
  const { [projectId]: removed, ...rest } = permissions
  if (!level) return { ...rest, [projectId]: { ...NO_PROJECT_ACCESS } }
  const permission = projectPermissionFor(level, isDeleteAllowed(removed))
  return level === DEFAULT_PROJECT_ACCESS_LEVEL
    ? rest
    : { ...rest, [projectId]: permission }
}

/** The permissions with deleting in a project allowed without asking, or not */
export function withProjectDeleteAllowed(
  permissions: Readonly<Record<string, ProjectPermission>>,
  projectId: string,
  isAllowed: boolean
): Record<string, ProjectPermission> {
  const current = effectiveProjectPermission(permissions, projectId)
  if (current.write !== 'allow') return { ...permissions }
  return {
    ...permissions,
    [projectId]: { ...current, delete: isAllowed ? 'allow' : 'ask' },
  }
}

const raise = (mode: ProjectAccessMode, isRaised: boolean) =>
  isRaised ? 'allow' : mode

/**
 * The permission with the operations "always allowed" from a call: what it
 * names becomes `allow`, deleting staying no freer than writing
 */
export function withAlwaysAllowedOperations(
  permission: ProjectPermission,
  operations: readonly ('read' | 'write' | 'delete')[]
): ProjectPermission {
  return normalizedProjectPermission({
    read: raise(permission.read, operations.includes('read')),
    write: raise(permission.write, operations.includes('write')),
    delete: raise(permission.delete, operations.includes('delete')),
  })
}
