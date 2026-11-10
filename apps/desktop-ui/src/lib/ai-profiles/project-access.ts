import type { ProjectPermission } from '@tyco/shared'

import {
  CHAT_TOOL_GROUPS,
  FILES_TOOL_GROUP_ID,
  type ProfileToolSettingsLike,
  toolGroupSettings,
} from '../chat-tools/chat-tool-groups'

/** How far a profile may go in a project it is connected to */
export type ProjectAccessLevel = 'askAll' | 'read' | 'readWriteAsk' | 'full'

export const PROJECT_ACCESS_LEVELS: readonly ProjectAccessLevel[] = [
  'askAll',
  'read',
  'readWriteAsk',
  'full',
]

export const PROJECT_ACCESS_LABEL_KEYS: Record<ProjectAccessLevel, string> = {
  askAll: 'settings.accessLevelAskAll',
  read: 'settings.accessLevelRead',
  readWriteAsk: 'settings.accessLevelReadWriteAsk',
  full: 'settings.accessLevelFull',
}

/** The level a newly connected project starts with */
export const DEFAULT_PROJECT_ACCESS_LEVEL: ProjectAccessLevel = 'read'

const PERMISSIONS: Record<ProjectAccessLevel, ProjectPermission> = {
  askAll: { read: 'ask', write: 'ask' },
  read: { read: 'allow', write: 'deny' },
  readWriteAsk: { read: 'allow', write: 'ask' },
  full: { read: 'allow', write: 'allow' },
}

export function projectPermissionFor(
  level: ProjectAccessLevel
): ProjectPermission {
  return { ...PERMISSIONS[level] }
}

/**
 * The level of a stored permission; `undefined` when the profile is not
 * connected to the project. Permissions written before the levels map to the
 * closest one by what they let write
 */
export function projectAccessLevelOf(
  permission: ProjectPermission | undefined
): ProjectAccessLevel | undefined {
  if (!permission) return undefined
  if (permission.write === 'allow') return 'full'
  if (permission.write === 'ask') {
    return permission.read === 'ask' ? 'askAll' : 'readWriteAsk'
  }
  return permission.read === 'deny' ? undefined : 'read'
}

/** The profile's file tools are off, so its project access does nothing */
export function hasFileToolsOff(profile: {
  tools?: ProfileToolSettingsLike | undefined
}): boolean {
  const group = CHAT_TOOL_GROUPS.find(({ id }) => id === FILES_TOOL_GROUP_ID)
  return !group || !toolGroupSettings(profile.tools, group).isEnabled
}

/** The permissions with one project connected at `level`, or removed */
export function withProjectAccess(
  permissions: Readonly<Record<string, ProjectPermission>>,
  projectId: string,
  level: ProjectAccessLevel | undefined
): Record<string, ProjectPermission> {
  const { [projectId]: _removed, ...rest } = permissions
  return level ? { ...rest, [projectId]: projectPermissionFor(level) } : rest
}
