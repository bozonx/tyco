import type {
  AiFileChangePreview,
  AiFileRoot,
  AiFileToolOutput,
  AiFileToolRequest,
  ProjectAccessMode,
} from '@tyco/shared'
import type { JsonSchema } from '@tyco/plugin-sdk'

import { FILES_TOOL_GROUP_ID } from './chat-tool-groups'
import type {
  ChatToolContext,
  ChatToolDefinition,
  ChatToolExecuteOptions,
  ChatToolProvider,
} from './chat-tool-registry'
import {
  formatFileRoots,
  formatFileToolOutput,
  formatTextPage,
  PAGE_NOTE_CHARACTERS,
  pageText,
} from './file-tool-format'

export interface FileToolsDependencies {
  listRoots: (profileId: string) => Promise<AiFileRoot[]>
  run: (
    profileId: string,
    request: AiFileToolRequest
  ) => Promise<AiFileToolOutput>
  preview: (
    profileId: string,
    request: AiFileToolRequest
  ) => Promise<AiFileChangePreview>
  /** The text of a PDF or DOCX in a root */
  readDocumentText: (
    profileId: string,
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

const ACCESS_ORDER: readonly ProjectAccessMode[] = ['allow', 'ask', 'deny']

/** The stricter of the access modes */
export function stricterAccess(
  ...modes: ProjectAccessMode[]
): ProjectAccessMode {
  return modes.reduce<ProjectAccessMode>(
    (strictest, mode) =>
      ACCESS_ORDER.indexOf(mode) > ACCESS_ORDER.indexOf(strictest)
        ? mode
        : strictest,
    'allow'
  )
}

/** The root a model's path is in; undefined for a path outside of them all */
export function fileRootOf(
  roots: readonly AiFileRoot[],
  path: string
): AiFileRoot | undefined {
  const parts = path.split(/[\\/]/).filter((part) => part && part !== '.')
  const rootPath =
    parts[0] === 'projects' && parts[1]
      ? `projects/${parts[1]}`
      : parts[0] === 'workspace'
        ? 'workspace'
        : undefined
  return roots.find((root) => root.path === rootPath)
}

const isEmptyPath = (path: string) =>
  path.split(/[\\/]/).every((part) => !part || part === '.')

const PATH: JsonSchema = {
  type: 'string',
  description:
    'A path starting with workspace/ or projects/<project-id>/, e.g. "workspace/notes.md"',
}

interface FileToolSpec {
  name: string
  labelKey: string
  icon: string
  description: string
  inputSchema: JsonSchema
  /** Whether the tool reads or changes files */
  access: 'read' | 'write'
  /** The paths of a call, which decide its access and scope */
  paths(input: Input): string[]
  /** @param outputLimitCharacters How much output the call may give */
  request(input: Input, outputLimitCharacters: number): AiFileToolRequest
  /** Whether the user is shown the change before deciding */
  hasPreview?: boolean
}

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
      'Creates a file, or replaces the whole content of one. Folders on the way are created. To change part of a file, use edit_file.',
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
    access: 'write',
    paths: (input) => [text(input.path)],
    request: (input) => ({ operation: 'deletePath', path: text(input.path) }),
  },
]

/** The names of the file tools, as the model calls them */
export const FILE_TOOL_NAMES = FILE_TOOLS.map((tool) => tool.name)

/**
 * The file tools of a profile chat: its workspace and the projects it has
 * permissions for. The folders and permissions are read for every turn; Rust
 * checks them again on every call
 */
export function createFileToolProvider(
  deps: FileToolsDependencies
): ChatToolProvider {
  // the roots a turn's tools were made with, for its instructions
  const turnRoots = new WeakMap<ChatToolContext, AiFileRoot[]>()

  function definition(
    spec: FileToolSpec,
    profileId: string,
    roots: readonly AiFileRoot[],
    groupAccess: ProjectAccessMode
  ): ChatToolDefinition {
    /** The roots of a call; an empty path reaches all that can be read */
    const rootsOf = (input: Input) =>
      spec
        .paths(input)
        .flatMap((path) =>
          isEmptyPath(path)
            ? spec.access === 'read'
              ? roots.filter((root) => root.read !== 'deny')
              : []
            : [fileRootOf(roots, path)]
        )

    const execute = async (input: unknown, options: ChatToolExecuteOptions) => {
      const request = spec.request(
        asInput(input),
        options.outputLimitCharacters
      )
      const output = await deps.run(profileId, request)
      if (output.operation !== 'readDocument')
        return formatFileToolOutput(output)
      const documentText = await deps.readDocumentText(
        profileId,
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
      groupId: FILES_TOOL_GROUP_ID,
      labelKey: spec.labelKey,
      icon: spec.icon,
      description: spec.description,
      inputSchema: spec.inputSchema,
      // the group's access is the most a call gets; each root may ask for less
      accessFor: (input) => {
        const callRoots = rootsOf(asInput(input))
        // a path outside every root fails in Rust, with a reason for the model
        if (callRoots.some((root) => !root)) return groupAccess
        return stricterAccess(
          groupAccess,
          ...callRoots.map((root) => root![spec.access])
        )
      },
      approvalScope: (input) =>
        spec
          .paths(asInput(input))
          .map((path) =>
            isEmptyPath(path) ? '*' : (fileRootOf(roots, path)?.path ?? path)
          )
          .join('>'),
      ...(spec.hasPreview
        ? {
            preview: async (input: unknown) => {
              const change = await deps.preview(
                profileId,
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
      const group = context.settings?.groups[FILES_TOOL_GROUP_ID]
      if (!context.profileId || !group?.isEnabled || group.access === 'deny')
        return []
      let roots: AiFileRoot[]
      try {
        roots = await deps.listRoots(context.profileId)
      } catch (error) {
        deps.warn?.(`The file tools are unavailable: ${String(error)}`)
        return []
      }
      turnRoots.set(context, roots)
      const profileId = context.profileId
      return FILE_TOOLS.map((spec) =>
        definition(spec, profileId, roots, group.access)
      )
    },
    instructions(context) {
      const roots = turnRoots.get(context)
      return roots ? formatFileRoots(roots) : undefined
    },
  }
}
