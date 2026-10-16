import {
  DEFAULT_TOOL_STEP_COUNT,
  MAX_TOOL_STEP_COUNT,
  type ProfileToolSettings,
  type ProjectAccessMode,
  type ToolGroupSettings,
} from '@tyco/shared'

/** A group of tools a profile switches on as a whole */
export interface ChatToolGroup {
  id: string
  labelKey: string
  descriptionKey: string
  icon: string
  /** How freely the group's tools run once it is switched on */
  defaultAccess: ProjectAccessMode
}

/** The file tools; mirrors FILES_TOOL_GROUP in Rust, which checks it too */
export const FILES_TOOL_GROUP_ID = 'files'

/** The groups the profile settings offer */
export const CHAT_TOOL_GROUPS: readonly ChatToolGroup[] = [
  {
    id: FILES_TOOL_GROUP_ID,
    labelKey: 'chatTools.files.group',
    descriptionKey: 'chatTools.files.groupHint',
    icon: 'mdi:folder-outline',
    // the permissions of each project decide; `ask` asks before every call
    defaultAccess: 'allow',
  },
]

/** A group's settings in a profile; off when the profile never set them */
export function toolGroupSettings(
  settings: ProfileToolSettings | undefined,
  group: Pick<ChatToolGroup, 'id' | 'defaultAccess'>
): ToolGroupSettings {
  return (
    settings?.groups[group.id] ?? {
      isEnabled: false,
      access: group.defaultAccess,
    }
  )
}

/** The settings with one group changed */
export function withToolGroup(
  settings: ProfileToolSettings | undefined,
  group: Pick<ChatToolGroup, 'id' | 'defaultAccess'>,
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

/** The settings with another step limit; undefined goes back to the default */
export function withToolStepCount(
  settings: ProfileToolSettings | undefined,
  maxStepCount: number | undefined
): ProfileToolSettings {
  const next: ProfileToolSettings = {
    ...settings,
    groups: settings?.groups ?? {},
  }
  if (maxStepCount === undefined) delete next.maxStepCount
  else next.maxStepCount = maxStepCount
  return next
}

/** A step limit typed in the settings; empty is the default */
export function parseToolStepCount(text: string): {
  value?: number
  isValid: boolean
} {
  const trimmed = text.trim()
  if (!trimmed) return { isValid: true }
  const value = Number(trimmed)
  return Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_TOOL_STEP_COUNT
    ? { value, isValid: true }
    : { isValid: false }
}

export { DEFAULT_TOOL_STEP_COUNT, MAX_TOOL_STEP_COUNT }
