import type { ProjectPermission } from '@tyco/shared'

import {
  CHAT_TOOL_GROUPS,
  FILES_TOOL_GROUP_ID,
  type ProfileToolSettingsLike,
  toolGroupSettings,
} from '../chat-tools/chat-tool-groups'

/** A level the settings offer for a project a profile is connected to */
export type SelectableProjectAccessLevel =
  'askAll' | 'read' | 'readWriteAsk' | 'full'

/**
 * How far a profile may go in a project it is connected to; `custom` for
 * permissions edited by hand that match no level, kept as they are
 */
export type ProjectAccessLevel = SelectableProjectAccessLevel | 'custom'

export const PROJECT_ACCESS_LEVELS: readonly SelectableProjectAccessLevel[] = [
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
  custom: 'settings.accessLevelCustom',
}

/** The level a newly connected project starts with */
export const DEFAULT_PROJECT_ACCESS_LEVEL: SelectableProjectAccessLevel = 'read'

const PERMISSIONS: Record<SelectableProjectAccessLevel, ProjectPermission> = {
  askAll: { read: 'ask', write: 'ask' },
  read: { read: 'allow', write: 'deny' },
  readWriteAsk: { read: 'allow', write: 'ask' },
  full: { read: 'allow', write: 'allow' },
}

export function projectPermissionFor(
  level: SelectableProjectAccessLevel
): ProjectPermission {
  return { ...PERMISSIONS[level] }
}

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
  const level = PROJECT_ACCESS_LEVELS.find(
    (candidate) =>
      PERMISSIONS[candidate].read === permission.read &&
      PERMISSIONS[candidate].write === permission.write
  )
  return level ?? 'custom'
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
  // a custom permission stays as it is
  if (level === 'custom') return { ...permissions }
  const { [projectId]: _removed, ...rest } = permissions
  return level ? { ...rest, [projectId]: projectPermissionFor(level) } : rest
}
