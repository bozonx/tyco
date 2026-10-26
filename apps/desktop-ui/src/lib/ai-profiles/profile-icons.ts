import type { AiProfile, AiProject } from '@tyco/shared'

export const DEFAULT_PROFILE_ICON = 'mdi:account-outline'

/** The icons a profile may pick, so that its tab stands out from the others */
export const PROFILE_ICONS: readonly string[] = [
  DEFAULT_PROFILE_ICON,
  'mdi:robot-outline',
  'mdi:briefcase-outline',
  'mdi:school-outline',
  'mdi:code-braces',
  'mdi:pencil-outline',
  'mdi:translate',
  'mdi:lightbulb-outline',
  'mdi:book-open-variant',
  'mdi:chart-line',
  'mdi:flask-outline',
  'mdi:heart-outline',
  'mdi:palette-outline',
  'mdi:scale-balance',
  'mdi:email-outline',
  'mdi:calendar-check-outline',
]

const KNOWN_ICONS = new Set(PROFILE_ICONS)

/** The icon a profile shows; an unknown one, e.g. typed by hand, is the default */
export function profileIcon(profile: Pick<AiProfile, 'icon'> | undefined) {
  const icon = profile?.icon
  return icon && KNOWN_ICONS.has(icon) ? icon : DEFAULT_PROFILE_ICON
}

/** The icon of a project: a linked folder or one of the vault's own */
export function projectIcon(project: Pick<AiProject, 'isExternal'>): string {
  return project.isExternal
    ? 'mdi:folder-open-outline'
    : 'mdi:folder-table-outline'
}
