import type { ProjectPermission } from './generated/desktop-types'

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
