import type { ProjectAccessMode } from './ai-profiles'

/** A folder a profile's file tools reach, as the profile sees it */
export interface AiFileRoot {
  /** What the model calls it: `workspace` or `projects/<id>` */
  path: string
  /** The project's name; absent for the workspace */
  name?: string
  description?: string
  read: ProjectAccessMode
  write: ProjectAccessMode
}

/** One call of a file tool; paths are the model's, inside the roots */
export type AiFileToolRequest =
  | {
      operation: 'listDir'
      /** Empty lists the roots */
      path?: string
      depth?: number
      /** A glob on file names, e.g. `*.md` */
      pattern?: string
    }
  | {
      operation: 'readFile'
      path: string
      /** The first line to read, from 1 */
      offset?: number
      limit?: number
      /** Whole lines are read up to this many characters */
      maxCharacters?: number
    }
  | {
      operation: 'searchFiles'
      /** Empty searches every root the profile may read */
      path?: string
      query?: string
      namePattern?: string
      isRegex?: boolean
    }
  | { operation: 'writeFile'; path: string; content: string }
  | {
      operation: 'editFile'
      path: string
      oldText: string
      newText: string
      replaceAll?: boolean
    }
  | { operation: 'movePath'; from: string; to: string }
  | { operation: 'deletePath'; path: string }

export interface AiFileEntry {
  /** A folder's path ends with `/` */
  path: string
  kind: 'file' | 'dir'
  size?: number
}

export interface AiFileSearchMatch {
  path: string
  /** Absent when the file matched by its name */
  line?: number
  text?: string
}

/** What a file tool did */
export type AiFileToolOutput =
  | {
      operation: 'listDir'
      path: string
      entries: AiFileEntry[]
      isTruncated: boolean
    }
  | {
      operation: 'readFile'
      path: string
      content: string
      startLine: number
      endLine: number
      totalLines: number
      /** The offset to read on from; absent at the end of the file */
      nextOffset?: number
    }
  /** A PDF or DOCX, whose text is read from its bytes */
  | { operation: 'readDocument'; path: string; mediaType: string }
  | {
      operation: 'searchFiles'
      matches: AiFileSearchMatch[]
      isTruncated: boolean
    }
  | { operation: 'writeFile'; path: string; isCreated: boolean; bytes: number }
  | { operation: 'editFile'; path: string; replacementCount: number }
  | { operation: 'movePath'; from: string; to: string }
  | { operation: 'deletePath'; path: string }

/** A change the user is asked about, before it is made */
export interface AiFileChangePreview {
  path: string
  /** Null for a file the change creates */
  before: string | null
  after: string
}
