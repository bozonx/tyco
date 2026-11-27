import type { WorkspaceInfo } from '@tyco/shared'

import { workspaceOfRef } from './profile-ref'

/** The name a workspace is shown by; the main one has none of its own */
export function workspaceLabel(
  workspace: Pick<WorkspaceInfo, 'isMain' | 'name' | 'path'>,
  mainLabel: string
): string {
  if (workspace.isMain) return mainLabel
  return (
    workspace.name.trim() ||
    workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ||
    workspace.path
  )
}

/**
 * The name of a profile with its workspace when another profile has that name
 * too, so that the two can be told apart
 */
export function entityLabel(
  item: { id: string; name: string },
  all: readonly { id: string; name: string }[],
  workspaces: readonly WorkspaceInfo[],
  mainLabel: string
): string {
  const isShared = all.some(
    (other) => other.id !== item.id && other.name.trim() === item.name.trim()
  )
  if (!isShared) return item.name
  const workspace = workspaces.find(
    (info) => info.workspaceId === workspaceOfRef(item.id)
  )
  return workspace
    ? `${item.name} (${workspaceLabel(workspace, mainLabel)})`
    : item.name
}
