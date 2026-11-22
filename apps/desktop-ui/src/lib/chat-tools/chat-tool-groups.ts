import {
  COMMANDS_TOOL_GROUP_ID,
  FILES_TOOL_GROUP_ID,
  type ProfileToolSettings,
  type ProjectAccessMode,
  type ToolGroupSettings,
  WEB_TOOL_GROUP_ID,
} from '@tyco/shared'




/** A group of tools a profile switches on as a whole */
export interface ChatToolGroup {
  id: string
  labelKey: string
  descriptionKey: string
  icon: string
  /** How freely the group's tools run once it is switched on */
  defaultAccess: ProjectAccessMode
  /** Whether the group is enabled when a profile has no explicit settings */
  defaultEnabled?: boolean
  /** Whether to show Ask/Allow access control switch */
  hasAccessControl?: boolean
  /** Whether the group renders extra details below its row */
  hasDetails?: boolean
}

export {
  COMMANDS_TOOL_GROUP_ID,
  FILES_TOOL_GROUP_ID,
  WEB_TOOL_GROUP_ID,
} from '@tyco/shared'

/** The groups the profile settings offer */
export const CHAT_TOOL_GROUPS: readonly ChatToolGroup[] = [
  {
    id: FILES_TOOL_GROUP_ID,
    labelKey: 'chatTools.files.group',
    descriptionKey: 'chatTools.files.groupHint',
    icon: 'mdi:folder-outline',
    defaultAccess: 'allow',
    hasAccessControl: false,
  },
  {
    id: WEB_TOOL_GROUP_ID,
    labelKey: 'chatTools.web.group',
    descriptionKey: 'chatTools.web.groupHint',
    icon: 'mdi:search-web',
    defaultAccess: 'allow',
    defaultEnabled: true,
    hasAccessControl: true,
  },
  {
    id: COMMANDS_TOOL_GROUP_ID,
    labelKey: 'chatTools.commands.group',
    descriptionKey: 'chatTools.commands.groupHint',
    icon: 'mdi:console-line',
    defaultAccess: 'ask',
    hasAccessControl: true,
    hasDetails: true,
  },
]

export interface ProfileToolSettingsLike {
  readonly groups?: {
    readonly [key: string]: {
      readonly isEnabled: boolean
      readonly access: ProjectAccessMode
      readonly commandIds?: readonly string[]
    }
  }
}

/**
 * A group's settings in a profile; uses defaultEnabled/defaultAccess when not
 * set
 */
export function toolGroupSettings(
  settings: ProfileToolSettings | ProfileToolSettingsLike | undefined,
  group: Pick<ChatToolGroup, 'id' | 'defaultAccess'> & {
    defaultEnabled?: boolean
  }
): ToolGroupSettings {
  const current = settings?.groups?.[group.id]
  if (!current) {
    return {
      isEnabled: Boolean(group.defaultEnabled),
      access: group.defaultAccess,
    }
  }
  return {
    isEnabled: current.isEnabled,
    access: current.access,
    ...(current.commandIds ? { commandIds: [...current.commandIds] } : {}),
  }
}

/** The settings with one group changed */
export function withToolGroup(
  settings: ProfileToolSettings | undefined,
  group: Pick<ChatToolGroup, 'id' | 'defaultAccess'> & {
    defaultEnabled?: boolean
  },
  patch: Partial<ToolGroupSettings>
): ProfileToolSettings {
  return {
    ...settings,
    groups: {
      ...settings?.groups,
      [group.id]: { ...toolGroupSettings(settings, group), ...patch },
    },
  }
}
