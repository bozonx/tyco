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

export interface AiVaultConfig {
  vaultPath?: string
}
