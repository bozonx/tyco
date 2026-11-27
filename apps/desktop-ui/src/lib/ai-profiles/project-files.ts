import type { AiProfile, AiProject, ProjectTransferPreview } from '@tyco/shared'

/** A message of the settings: an i18n key with its parameters */
export interface ProjectFilesMessage {
  key: string
  params?: Record<string, string | number>
}

export interface ProjectTransferCheck {
  /** What stops the conversion until the user deals with it */
  blockers: ProjectFilesMessage[]
  /** What the user should know before converting */
  notices: ProjectFilesMessage[]
}

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']

/** `bytes` as a short size in the units of `locale`: "18 MB" */
export function formatByteSize(bytes: number, locale: string): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: SIZE_UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 || value >= 10 ? 0 : 1,
  }).format(value)
}

/** At most `limit` names, the rest as "…" */
function listNames(names: readonly string[], limit = 3): string {
  const shown = names.slice(0, limit).join(', ')
  return names.length > limit ? `${shown}, …` : shown
}

/**
 * What a conversion would meet: files to move into a folder that has the same
 * names, links leading out of the project, a git repository going to the synced
 * workspace, a copy to another disk. `isTransferring` is false when an external
 * project becomes internal without its files.
 */
export function checkProjectTransfer(
  preview: ProjectTransferPreview,
  options: { toExternal: boolean; isTransferring: boolean }
): ProjectTransferCheck {
  const check: ProjectTransferCheck = { blockers: [], notices: [] }
  if (!options.isTransferring) return check
  if (preview.takenNames.length > 0)
    check.blockers.push({
      key: 'settings.projectConvertTakenNames',
      params: { names: listNames(preview.takenNames) },
    })
  if (preview.files.outsideLinks.length > 0)
    check.blockers.push({
      key: 'settings.projectConvertOutsideLinks',
      params: { links: listNames(preview.files.outsideLinks) },
    })
  if (!options.toExternal && preview.files.hasGit)
    check.notices.push({ key: 'settings.projectConvertHasGit' })
  if (preview.isOtherDisk && preview.files.fileCount > 0)
    check.notices.push({ key: 'settings.projectConvertOtherDisk' })
  return check
}

/**
 * Whether deleting the project loses nothing, so it needs no confirmation: no
 * description, no access set by hand in a profile, and no files: an internal
 * project holds none (`fileCount`, unknown when it could not be counted), an
 * external one has no folder on this device.
 */
export function isProjectEmpty(
  project: AiProject,
  profiles: readonly Pick<AiProfile, 'projectPermissions'>[],
  fileCount: number | null
): boolean {
  if (project.description?.trim()) return false
  if (profiles.some((profile) => profile.projectPermissions[project.id]))
    return false
  return project.isExternal ? !project.targetPath?.trim() : fileCount === 0
}
