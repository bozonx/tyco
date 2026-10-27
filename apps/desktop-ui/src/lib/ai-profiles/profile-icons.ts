import type { AiProject } from '@tyco/shared'

/** The icon of a project: a linked folder or one of the vault's own */
export function projectIcon(project: Pick<AiProject, 'isExternal'>): string {
  return project.isExternal
    ? 'mdi:folder-open-outline'
    : 'mdi:folder-table-outline'
}
