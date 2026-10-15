export type ProjectAccessMode = 'allow' | 'ask' | 'deny'

export interface ProjectPermission {
  read: ProjectAccessMode
  write: ProjectAccessMode
}

export interface AiProfile {
  id: string
  name: string
  icon?: string
  lastModelId?: string
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
