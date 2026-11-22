import type {
  AiAttachedFile,
  AiFileChangePreview,
  AiFileRoot,
  AiFileToolOutput,
  AiFileToolRequest,
  ProjectAccessMode,
  ToolCallContext,
  ToolRisk,
} from '@tyco/shared'
import type { JsonSchema } from '@tyco/plugin-sdk'

import { isStricterAccess, stricterAccess } from './chat-tool-policy'
import { fileRootPathOf } from './file-location'
import type {
  ChatToolAlwaysAllowTarget,
  ChatToolContext,
  ChatToolDefinition,
  ChatToolExecuteOptions,
  ChatToolProvider,
} from './chat-tool-registry'
import {
  ATTACHMENTS_SOURCE,
  FILES_SOURCE,
  isSourceAvailable,
  isSourceEnabledInProfile,
  type ToolSourceRef,
} from './tool-catalog'
import {
  formatFileRoots,
  formatFileToolOutput,
  formatTextPage,
  PAGE_NOTE_CHARACTERS,
  pageText,
} from './file-tool-format'

/**
 * What the file tools of a conversation reach: its attachments, and the folders
 * of its profile. Rust resolves both; see `dev_docs/chat-files.md`
 */
export interface FileToolScope {
  /** Where the call comes from: a profile chat reaches its folders */
  context: ToolCallContext
  attachments: readonly AiAttachedFile[]
}

export interface FileToolsDependencies {
  listRoots: (scope: FileToolScope) => Promise<AiFileRoot[]>
  run: (
    scope: FileToolScope,
    request: AiFileToolRequest
  ) => Promise<AiFileToolOutput>
  preview: (
    scope: FileToolScope,
    request: AiFileToolRequest
  ) => Promise<AiFileChangePreview>
  /** The text of a PDF or DOCX in a root */
  readDocumentText: (
    scope: FileToolScope,
    path: string,
    mediaType: string
  ) => Promise<string>
  warn?: (message: string) => void
}

type Input = Record<string, unknown>

const asInput = (input: unknown): Input =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Input)
    : {}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export { stricterAccess }

/** The root a model's path is in; undefined for a path outside of them all */
export function fileRootOf(
  roots: readonly AiFileRoot[],
  path: string
): AiFileRoot | undefined {
  const rootPath = fileRootPathOf(path)
  return roots.find((root) => root.path === rootPath)
}

const isEmptyPath = (path: string) =>
  path.split(/[\\/]/).every((part) => !part || part === '.')

const PATH: JsonSchema = {
  type: 'string',
  description:
    'A path starting with attachments/, workspace/ or projects/<project-id>/, e.g. "workspace/notes.md"',
}

type FileAccess = 'read' | 'write' | 'delete'

interface FileToolSpec {
  name: string
  labelKey: string
  icon: string
  description: string
  inputSchema: JsonSchema
  /** Whether the tool reads, changes or deletes files */
  access: FileAccess
  /** The paths of a call, which decide its access and scope */
  paths(input: Input): string[]
  /**
   * The access each path of `paths` needs, when not `access`: a move takes its
   * file away from where it was, which is deleting it there
   */
  pathAccess?: readonly FileAccess[]
  /** @param outputLimitCharacters How much output the call may give */
  request(input: Input, outputLimitCharacters: number): AiFileToolRequest
  /** Whether the user is shown the change before deciding */
  hasPreview?: boolean
}

const RISK_OF: Record<FileToolSpec['access'], ToolRisk> = {
  read: 'read',
  write: 'write',
  delete: 'destructive',
}

const PROJECT_ROOT_PREFIX = 'projects/'

// The output limiter counts UTF-16 units; one Unicode scalar may take two.
// Keep the continuation note within that budget even for non-BMP text.
const pageCharacterLimit = (outputLimitCharacters: number) =>
  Math.max(1, Math.floor((outputLimitCharacters - PAGE_NOTE_CHARACTERS) / 2))

const FILE_TOOLS: readonly FileToolSpec[] = [
  {
    name: 'list_files',
    labelKey: 'chatTools.files.listFiles',
    icon: 'mdi:folder-open-outline',
    description:
      'Lists the files and folders in a folder. Without a path it lists the folders you can reach. Ignored and hidden files are left out.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          ...PATH,
          description: `${PATH.description}; empty for the top`,
        },
        depth: {
          type: 'integer',
          minimum: 1,
          maximum: 5,
          description: 'How many levels down to list; 1 by default',
        },
        pattern: {
          type: 'string',
          description: 'Only files whose name matches this glob, e.g. "*.md"',
        },
      },
    },
    access: 'read',
    paths: (input) => [text(input.path)],
    request: (input) => ({
      operation: 'listDir',
      path: text(input.path),
      ...(count(input.depth) ? { depth: count(input.depth) } : {}),
      ...(text(input.pattern) ? { pattern: text(input.pattern) } : {}),
    }),
  },
  {
    name: 'read_file',
    labelKey: 'chatTools.files.readFile',
    icon: 'mdi:file-document-outline',
    description:
      'Reads a text file, a PDF or a DOCX. A long file comes in pages of lines: the output says which offset to read on from.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH,
        offset: {
          type: 'integer',
          minimum: 1,
          description: 'The first line to read, from 1',
        },
        characterOffset: {
          type: 'integer',
          minimum: 0,
          description:
            'Unicode characters to skip in the first line, from 0; use the continuation cursor from the output',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'How many lines to read',
        },
      },
      required: ['path'],
    },
    access: 'read',
    paths: (input) => [text(input.path)],
    request: (input, outputLimitCharacters) => ({
      operation: 'readFile',
      path: text(input.path),
      ...(count(input.offset) ? { offset: count(input.offset) } : {}),
      ...(count(input.limit) ? { limit: count(input.limit) } : {}),
      ...(count(input.characterOffset)
        ? { characterOffset: count(input.characterOffset) }
        : {}),
      maxCharacters: pageCharacterLimit(outputLimitCharacters),
    }),
  },
  {
    name: 'search_files',
    labelKey: 'chatTools.files.searchFiles',
    icon: 'mdi:file-search-outline',
    description:
      'Finds files by name and lines by their text. A lowercase query matches any case. Without a path it searches every folder you can read.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { ...PATH, description: `${PATH.description}; empty for all` },
        query: { type: 'string', description: 'Text the lines contain' },
        namePattern: {
          type: 'string',
          description: 'A glob the file names match, e.g. "*.md"',
        },
        isRegex: {
          type: 'boolean',
          description: 'Whether the query is a regular expression',
        },
      },
    },
    access: 'read',
    paths: (input) => [text(input.path)],
    request: (input) => ({
      operation: 'searchFiles',
      path: text(input.path),
      ...(text(input.query) ? { query: text(input.query) } : {}),
      ...(text(input.namePattern)
        ? { namePattern: text(input.namePattern) }
        : {}),
      ...(input.isRegex === true ? { isRegex: true } : {}),
    }),
  },
  {
    name: 'write_file',
    labelKey: 'chatTools.files.writeFile',
    icon: 'mdi:file-edit-outline',
    description:
      'Creates a text file of any format (Markdown, code, JSON, CSV…), or replaces the whole content of one. Folders on the way are created. Files the user asks to save go to workspace/ unless they name a project. To change part of a file, use edit_file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH,
        content: { type: 'string', description: 'The whole new content' },
      },
      required: ['path', 'content'],
    },
    access: 'write',
    paths: (input) => [text(input.path)],
    request: (input) => ({
      operation: 'writeFile',
      path: text(input.path),
      content: text(input.content),
    }),
    hasPreview: true,
  },
  {
    name: 'edit_file',
    labelKey: 'chatTools.files.editFile',
    icon: 'mdi:file-replace-outline',
    description:
      'Replaces a fragment of a text file. oldText must be copied exactly from the file and appear in it once, unless replaceAll is set.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH,
        oldText: { type: 'string', description: 'The text to replace' },
        newText: { type: 'string', description: 'What replaces it' },
        replaceAll: {
          type: 'boolean',
          description: 'Replace every occurrence instead of exactly one',
        },
      },
      required: ['path', 'oldText', 'newText'],
    },
    access: 'write',
    paths: (input) => [text(input.path)],
    request: (input) => ({
      operation: 'editFile',
      path: text(input.path),
      oldText: text(input.oldText),
      newText: text(input.newText),
      ...(input.replaceAll === true ? { replaceAll: true } : {}),
    }),
    hasPreview: true,
  },
  {
    name: 'move_path',
    labelKey: 'chatTools.files.movePath',
    icon: 'mdi:file-move-outline',
    description:
      'Moves or renames a file or a folder. The destination must not exist; folders on the way are created.',
    inputSchema: {
      type: 'object',
      properties: { from: PATH, to: PATH },
      required: ['from', 'to'],
    },
    access: 'write',
    paths: (input) => [text(input.from), text(input.to)],
    pathAccess: ['delete', 'write'],
    request: (input) => ({
      operation: 'movePath',
      from: text(input.from),
      to: text(input.to),
    }),
  },
  {
    name: 'delete_path',
    labelKey: 'chatTools.files.deletePath',
    icon: 'mdi:delete-outline',
    description:
      'Moves a file or a folder to the trash, from where the user can restore it.',
    inputSchema: {
      type: 'object',
      properties: { path: PATH },
      required: ['path'],
    },
    access: 'delete',
    paths: (input) => [text(input.path)],
    request: (input) => ({ operation: 'deletePath', path: text(input.path) }),
  },
]

/**
 * The file tools of a conversation: the files attached to it, read-only, and in
 * a profile chat with the files group on, its workspace and the projects it has
 * permissions for. Without the group the attachments are read through the
 * always-on `attachments` group. The folders and permissions are read for every
 * turn; Rust checks them again on every call
 */
export function createFileToolProvider(
  deps: FileToolsDependencies
): ChatToolProvider {
  // the roots a turn's tools were made with, for its instructions
  const turnRoots = new WeakMap<ChatToolContext, AiFileRoot[]>()

  function definition(
    spec: FileToolSpec,
    scope: FileToolScope,
    /** The roots of the turn, updated when a call finds them changed */
    turn: { roots: readonly AiFileRoot[] },
    source: ToolSourceRef
  ): ChatToolDefinition {
    /**
     * The roots of a call with the access each needs; an empty path reaches all
     * that can be read. A root is undefined for a path outside of them all
     */
    const targetsOf = (input: Input) =>
      spec.paths(input).flatMap((path, index) => {
        const access = spec.pathAccess?.[index] ?? spec.access
        if (!isEmptyPath(path))
          return [{ root: fileRootOf(turn.roots, path), access }]
        return access === 'read'
          ? turn.roots
              .filter((root) => root.read !== 'deny')
              .map((root) => ({ root, access }))
          : []
      })

    // the permissions of the roots of a call decide; the tool's policy may
    // ask for more
    const accessFor = (input: unknown): ProjectAccessMode => {
      const targets = targetsOf(asInput(input))
      // a path outside every root fails in Rust, with a reason for the model
      if (targets.some((target) => !target.root)) return 'allow'
      return stricterAccess(
        ...targets.map((target) => target.root![target.access])
      )
    }

    /**
     * "Always allow" raises the permission of the call's project; deleting
     * where writing asks raises both, as the button says
     */
    const alwaysAllowTarget = (
      input: unknown
    ): ChatToolAlwaysAllowTarget | undefined => {
      if (spec.access === 'read') return undefined
      const targets = targetsOf(asInput(input))
      if (targets.some((target) => !target.root)) return undefined
      const inProjects = targets.filter((target) =>
        target.root!.path.startsWith(PROJECT_ROOT_PREFIX)
      )
      const roots = [...new Set(inProjects.map((target) => target.root!))]
      // one project at a time: a move between two is allowed once
      if (roots.length !== 1) return undefined
      const root = roots[0]!
      const needed = new Set(inProjects.map((target) => target.access))
      if (needed.has('delete') && root.write !== 'allow') needed.add('write')
      // only what still asks there, so that the button names what changes
      const operations = (['write', 'delete'] as const).filter(
        (operation) => needed.has(operation) && root[operation] !== 'allow'
      )
      if (!operations.length) return undefined
      return {
        kind: 'project',
        projectId: root.path.slice(PROJECT_ROOT_PREFIX.length),
        operations,
      }
    }

    /**
     * Fails when the permissions became stricter since the call was approved by
     * the roots of the turn, e.g. `allow` turned to `ask` in the settings: Rust
     * enforces `deny` only, so the call is not run without asking
     */
    const recheckAccess = async (input: unknown) => {
      const approved = accessFor(input)
      let current: AiFileRoot[]
      try {
        current = await deps.listRoots(scope)
      } catch {
        return
      }
      turn.roots = current
      const now = accessFor(input)
      if (isStricterAccess(now, approved))
        throw new Error(
          'The access to this folder changed during the conversation: call the tool again to ask the user'
        )
    }

    const execute = async (input: unknown, options: ChatToolExecuteOptions) => {
      await recheckAccess(input)
      const request = spec.request(
        asInput(input),
        options.outputLimitCharacters
      )
      const output = await deps.run(scope, request)
      if (output.operation !== 'readDocument')
        return formatFileToolOutput(output)
      const documentText = await deps.readDocumentText(
        scope,
        output.path,
        output.mediaType
      )
      return formatTextPage(
        pageText(
          documentText,
          (request.operation === 'readFile' ? request.offset : null) ??
            undefined,
          (request.operation === 'readFile' ? request.limit : null) ??
            undefined,
          pageCharacterLimit(options.outputLimitCharacters),
          (request.operation === 'readFile' ? request.characterOffset : null) ??
            undefined
        ),
        output.path
      )
    }

    return {
      name: spec.name,
      source,
      risk: RISK_OF[spec.access],
      // the project permissions decide; the workspace is the profile's own
      defaultPolicy: 'allow',
      readsPersonalData: true,
      labelKey: spec.labelKey,
      icon: spec.icon,
      description: spec.description,
      inputSchema: spec.inputSchema,
      accessFor,
      ...(source === FILES_SOURCE ? { alwaysAllowTarget } : {}),
      approvalScope: (input) =>
        spec
          .paths(asInput(input))
          .map((path) =>
            isEmptyPath(path)
              ? '*'
              : (fileRootOf(turn.roots, path)?.path ?? path)
          )
          .join('>'),
      ...(spec.hasPreview
        ? {
            preview: async (input: unknown) => {
              const change = await deps.preview(
                scope,
                spec.request(asInput(input), 0)
              )
              return { kind: 'file-change' as const, ...change }
            },
          }
        : {}),
      execute,
    }
  }

  return {
    id: 'files',
    async tools(context) {
      const scope: FileToolScope = {
        context: context.callContext,
        attachments: context.attachedFiles ?? [],
      }
      const { scope: toolScope } = context
      const hasFolders =
        toolScope.kind === 'profile' &&
        isSourceAvailable(toolScope.catalog, FILES_SOURCE) &&
        isSourceEnabledInProfile(toolScope.settings, FILES_SOURCE)
      if (!hasFolders && !scope.attachments.length) return []
      let roots: AiFileRoot[]
      try {
        roots = await deps.listRoots(scope)
      } catch (error) {
        deps.warn?.(`The file tools are unavailable: ${String(error)}`)
        return []
      }
      turnRoots.set(context, roots)
      const turn = { roots }
      if (hasFolders)
        return FILE_TOOLS.map((spec) =>
          definition(spec, scope, turn, FILES_SOURCE)
        )
      // the user's own files of this conversation: read freely, never changed
      return FILE_TOOLS.filter((spec) => spec.access === 'read').map((spec) =>
        definition(spec, scope, turn, ATTACHMENTS_SOURCE)
      )
    },
    instructions(context) {
      const roots = turnRoots.get(context)
      return roots ? formatFileRoots(roots) : undefined
    },
  }
}

/** The names of the file tools, to tell their calls in a chat */
export const FILE_TOOL_NAMES: ReadonlySet<string> = new Set(
  FILE_TOOLS.map((spec) => spec.name)
)

/** The file tools as the catalog lists them */
export const FILE_TOOL_CATALOG = FILE_TOOLS.map((spec) => ({
  name: spec.name,
  labelKey: spec.labelKey,
  risk: RISK_OF[spec.access],
  defaultPolicy: 'allow' as const,
}))
