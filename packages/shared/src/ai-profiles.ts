import type { ProjectPermission } from './generated/desktop-types'

/** What a profile may do with a project it has no permission entry for */
export const DEFAULT_PROJECT_PERMISSION: Readonly<ProjectPermission> = {
  read: 'deny',
  write: 'deny',
}

/** Model steps a profile's chat may take in one turn by default */
export const DEFAULT_TOOL_STEP_COUNT = 8
