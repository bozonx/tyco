import type { WorkspaceFolder } from '@tyco/shared'

export interface WorkspaceAttachDependencies {
  /** The folder the user picks; null when the dialog is closed */
  pickFolder: () => Promise<string | null>
  inspect: (path: string) => Promise<WorkspaceFolder>
  attach: (path: string, name: string) => Promise<void>
  /** The name of a new workspace; null when the user gives up */
  askName: () => Promise<string | null>
  /** Whether a workspace goes to `subfolder` of a folder of other files */
  confirmSubfolder: (subfolder: string) => Promise<boolean>
  /** Tells why a folder cannot be attached */
  refuse: (reason: 'duplicate' | 'nested' | 'occupied', detail: string) => void
}

/**
 * Attaches a folder the user picks: a workspace there as it is, a new workspace
 * in an empty one, a subfolder in one of other files. A copy of a workspace
 * that is here already, or a folder nested with the data folder or another
 * workspace, is refused with a reason. Returns whether a workspace was
 * attached
 */
export async function attachPickedWorkspace(
  deps: WorkspaceAttachDependencies
): Promise<boolean> {
  const picked = await deps.pickFolder()
  if (!picked) return false
  let folder = await deps.inspect(picked)
  if (folder.kind.kind === 'occupied') {
    if (!(await deps.confirmSubfolder(folder.kind.subfolder))) return false
    folder = await deps.inspect(folder.kind.subfolder)
  }
  switch (folder.kind.kind) {
    case 'workspace':
      await deps.attach(folder.path, '')
      return true
    case 'empty': {
      const name = await deps.askName()
      if (name === null) return false
      await deps.attach(folder.path, name)
      return true
    }
    case 'duplicate':
      deps.refuse('duplicate', folder.path)
      return false
    case 'nested':
      deps.refuse('nested', folder.kind.message)
      return false
    case 'occupied':
      // the subfolder holds other files too
      deps.refuse('occupied', folder.path)
      return false
  }
}
