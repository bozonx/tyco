export type ProjectAccessMode = 'allow' | 'ask' | 'deny'

export interface ProjectPermission {
  read: ProjectAccessMode
  write: ProjectAccessMode
}

/** What a profile may do with a project it has no permission entry for */
export const DEFAULT_PROJECT_PERMISSION: Readonly<ProjectPermission> = {
  read: 'deny',
  write: 'deny',
}

/** The highest temperature a profile may set */
export const MAX_PROFILE_TEMPERATURE = 2

/** Model steps a profile's chat may take in one turn by default */
export const DEFAULT_TOOL_STEP_COUNT = 8

/** The most model steps a profile may allow in one turn */
export const MAX_TOOL_STEP_COUNT = 50

/** Whether a group of tools is offered to the model, and how freely */
export interface ToolGroupSettings {
  isEnabled: boolean
  /** `ask` waits for the user before each call; with no UI it means `deny` */
  access: ProjectAccessMode
}

/** The tools a profile's chat may use */
export interface ProfileToolSettings {
  /** By tool group id; a group that is not listed is off */
  groups: Record<string, ToolGroupSettings>
  /** Model steps per turn; `DEFAULT_TOOL_STEP_COUNT` when unset */
  maxStepCount?: number
}

/** A profile; its root instruction lives next to it in `SOUL.md` */
export interface AiProfile {
  id: string
  name: string
  /** The model its chats run on; the first usable one when unset */
  modelId?: string
  /** Overrides the model's temperature */
  temperature?: number
  /** Caps the answer below the model's own output limit */
  maxOutputTokens?: number
  projectPermissions: Record<string, ProjectPermission>
  /** No tools when unset */
  tools?: ProfileToolSettings
  createdAt: number
  updatedAt: number
}

export interface AiProject {
  id: string
  name: string
  description?: string
  isExternal: boolean
  targetPath?: string | null
  createdAt: number
  updatedAt: number
}
