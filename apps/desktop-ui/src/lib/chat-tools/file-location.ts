/**
 * Where a path of the file tools points: the chat's attachments, the profile's
 * workspace or a project. See `dev_docs/chat-files.md`
 */
export type FileLocation =
  | { kind: 'attachments' }
  | { kind: 'workspace' }
  | { kind: 'project'; projectId: string }

/**
 * The model's root folder of a path: `workspace`, `projects/<id>` or
 * `attachments`
 */
export function fileRootPathOf(path: string): string | undefined {
  const parts = path.split(/[\\/]/).filter((part) => part && part !== '.')
  if (parts[0] === 'projects' && parts[1]) return `projects/${parts[1]}`
  if (parts[0] === 'workspace' || parts[0] === 'attachments') return parts[0]
  return undefined
}

export function fileLocationOf(path: string): FileLocation | undefined {
  const rootPath = fileRootPathOf(path)
  if (!rootPath) return undefined
  if (rootPath === 'workspace' || rootPath === 'attachments')
    return { kind: rootPath }
  return { kind: 'project', projectId: rootPath.slice('projects/'.length) }
}

/** The tool input fields that hold paths of the file tools */
const PATH_FIELDS = ['path', 'from', 'to'] as const

/** The distinct locations a file tool call works in, in the order of its fields */
export function fileLocationsOfInput(input: unknown): FileLocation[] {
  if (!input || typeof input !== 'object') return []
  const locations: FileLocation[] = []
  const keys = new Set<string>()
  for (const field of PATH_FIELDS) {
    const value = (input as Record<string, unknown>)[field]
    if (typeof value !== 'string') continue
    const location = fileLocationOf(value)
    if (!location) continue
    const key =
      location.kind === 'project'
        ? `project:${location.projectId}`
        : location.kind
    if (keys.has(key)) continue
    keys.add(key)
    locations.push(location)
  }
  return locations
}
