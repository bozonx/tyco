/**
 * Tool sources and the permissions to them, see `dev_docs/architecture.md`,
 * "Tool sources and permissions"
 */

/** Where a tool comes from */
export const TOOL_SOURCE_KINDS = ['core', 'plugin', 'mcp', 'commands'] as const
export type ToolSourceKind = (typeof TOOL_SOURCE_KINDS)[number]

/**
 * What a tool may do: `read` without side effects, `write` changes the user's
 * data, `destructive` deletes or cannot be undone, `external` makes a request
 * outside the app: the network, a script, another program
 */
export const TOOL_RISKS = ['read', 'write', 'destructive', 'external'] as const
export type ToolRisk = (typeof TOOL_RISKS)[number]

/** How freely an enabled tool runs */
export type ToolPolicy = 'ask' | 'allow'

/** A stable reference to a tool source, or to one of its tools */
export interface ToolRef {
  sourceKind: ToolSourceKind
  /** `files`, `web`, a plugin id, an MCP server id, or `commands` */
  sourceId: string
  /** The whole source when absent */
  toolName?: string
  /** An explicit override of the whitelist grant for an AI command */
  policy?: ToolPolicy
}

/**
 * The tool catalog: the sources and tools switched off everywhere, for every
 * profile and AI command; "Ask AI" has its own web switch. What is not listed
 * is on
 */
export interface ToolCatalogSettings {
  /** By source key, `<kind>:<id>` */
  sources: Record<string, { isEnabled: boolean }>
  /** By tool key, `<kind>:<id>:<tool>` */
  tools?: Record<string, { isEnabled: boolean }>
}
