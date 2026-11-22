import {
  dynamicTool,
  jsonSchema,
  type ToolApproval,
  type ToolSet,
} from '@bozonx/ai-kit'
import type {
  AiAttachedFile,
  ProfileMemoryMode,
  ProjectAccessMode,
  ToolCallContext,
  ToolPolicy,
  ToolRisk,
} from '@tyco/shared'
import type { JsonSchema } from '@tyco/plugin-sdk'

import {
  MIN_TOOL_OUTPUT_CHARACTERS,
  normalizeToolOutput,
  TOOL_OUTPUT_CHARACTERS,
} from './chat-tool-output'
import {
  chatToolApprovalKey,
  stricterAccess,
  type ChatToolPolicy,
} from './chat-tool-policy'
import {
  toolKey,
  toolStateIn,
  type ToolScope,
  type ToolSourceRef,
} from './tool-catalog'
import { MAX_TOOL_NAME_LENGTH } from './tool-name'

/** Names the AI providers accept for a tool */
const TOOL_NAME = new RegExp(`^[a-zA-Z0-9_-]{1,${MAX_TOOL_NAME_LENGTH}}$`)

export interface ChatToolExecuteOptions {
  signal: AbortSignal
  toolCallId: string
  /**
   * How much of the output the model is given: the tool's own limit, or less
   * when the turn's steps have used up most of the context. A tool that pages
   * its output fits a page into it
   */
  outputLimitCharacters: number
}

/** What the user is shown of a call before deciding on it */
export interface ChatToolPreview {
  kind: 'file-change'
  path: string
  /** Null for a file the call creates */
  before: string | null
  after: string
}

/** One tool the model may call */
export interface ChatToolDefinition {
  /** Unique in a request; what the model calls the tool by */
  name: string
  /** Where the tool comes from; its settings decide whether it is offered */
  source: ToolSourceRef
  /**
   * The tool's name in the settings, unique in its source; the model's name
   * when absent. A command's is its id, say
   */
  catalogName?: string
  /** What the tool may do, which sets its default policy */
  risk: ToolRisk
  /** The policy when the user set none, over the one of its risk */
  defaultPolicy?: ToolPolicy
  /** A tool of a plugin that does not come with Tyco: it asks by default */
  isThirdParty?: boolean
  /** The plugin's permissions, shown when a call asks */
  capabilities?: readonly string[]
  /** The name of the plugin, MCP server or command, shown when a call asks */
  sourceLabel?: string
  /** The name the chat shows: an i18n key for a core tool */
  labelKey?: string
  /** The name the chat shows when it comes from a plugin or MCP server */
  label?: string
  /** An Iconify name shown next to the call */
  icon?: string
  /** Shown to the model, in English: what the tool does, when to use it */
  description: string
  inputSchema: JsonSchema
  /**
   * The access of one call, when it depends on the input — a path in a
   * read-only project, say. Never freer than the tool's policy
   */
  accessFor?(input: unknown): ProjectAccessMode | undefined
  /**
   * What "always allow" of a call raises besides the tool's policy, when its
   * input asks: the permission of the project a path is in, say. Undefined when
   * the call cannot be allowed for good
   */
  alwaysAllowTarget?(input: unknown): ChatToolAlwaysAllowTarget | undefined
  /**
   * Where a call may send data out, once the conversation holds personal data:
   * asked about once per target in a chat, even when allowed. A tool of the
   * `external` risk is a target of its own when absent; undefined for a call
   * that sends nothing new out, e.g. a page the conversation named
   */
  leakTarget?(
    input: unknown,
    isKnownUrl: (url: string) => boolean
  ): string | undefined
  /** Its calls bring personal data into the conversation: files, memory */
  readsPersonalData?: boolean
  /** Its output names URLs the model may then read, e.g. search results */
  givesKnownUrls?: boolean
  /**
   * Its output is written by somebody else — a web page, a command, a plugin —
   * and may try to steer the model
   */
  givesUntrustedContent?: boolean
  /**
   * Its calls change what outlives the chat, e.g. the memory: once the
   * conversation holds untrusted content they ask, even when allowed, so that a
   * page cannot plant instructions for the chats to come
   */
  asksAfterUntrustedContent?: boolean
  /**
   * What "allow in this session" covers besides the tool, e.g. the project a
   * path is in. The whole tool when absent
   */
  approvalScope?(input: unknown): string | undefined
  /** Shown with the approval request; a failure only leaves it out */
  preview?(
    input: unknown,
    signal: AbortSignal
  ): Promise<ChatToolPreview | undefined>
  /** How much of the output the model is given */
  outputLimitCharacters?: number
  /**
   * The call is the answer itself: once it ran, the turn ends without another
   * model step that would only repeat it in words
   */
  endsTurn?: boolean
  /**
   * Runs the call. A thrown error is reported to the model as the call's
   * failure, which it can react to
   */
  execute(input: unknown, options: ChatToolExecuteOptions): Promise<unknown>
}

/** What "always allow" of a call writes into the profile */
export type ChatToolAlwaysAllowTarget =
  /** The tool's policy becomes `allow` */
  | { kind: 'tool'; source: ToolSourceRef; toolName: string }
  /** The project's permissions for these operations become `allow` */
  | {
      kind: 'project'
      projectId: string
      operations: readonly ('read' | 'write' | 'delete')[]
    }

/** What a request offers tools for */
export interface ChatToolContext {
  /** Null outside a profile chat */
  profileId: string | null
  modelId: string
  /** Where the tools are offered, which decides about each of them */
  scope: ToolScope
  /** Where Rust is told the calls come from */
  callContext: ToolCallContext
  /** Profile long-term memory mode */
  memoryMode?: ProfileMemoryMode
  /** The originals attached to the conversation, by the names the model uses */
  attachedFiles?: readonly AiAttachedFile[]
  /**
   * How much the outputs of the turn's tools may add to the request in all;
   * unlimited when absent
   */
  outputBudgetCharacters?: number
}

/**
 * A source of tools: files, commands, MCP servers. Later phases add one each
 * without touching the registry
 */
export interface ChatToolProvider {
  id: string
  tools(
    context: ChatToolContext
  ): ChatToolDefinition[] | Promise<ChatToolDefinition[]>
  /**
   * What the model is told besides the tools' descriptions, e.g. the folders it
   * can reach. Asked after `tools`, with the same context, only when the
   * provider offered a tool
   */
  instructions?(context: ChatToolContext): string | undefined
}

/** The tools of one request, ready for the model */
export interface ChatToolSet {
  tools: ToolSet
  toolApproval: ToolApproval
  definitions: ReadonlyMap<string, ChatToolDefinition>
  /** The calls whose output was cut, so the chat can mark them */
  truncatedCallIds: ReadonlySet<string>
  /** What "allow in this session" of a call is remembered by */
  approvalKey(toolName: string, input: unknown): string
  /** What the user is told of a call that asks, and may answer it with */
  approvalInfo(toolName: string, input: unknown): ChatToolApprovalInfo
  /** Added to the system instructions; absent when no provider has any */
  instructions?: string
}

/** What the user is shown of a call that asks */
export interface ChatToolApprovalInfo {
  /** What "allow in this chat" is remembered by */
  approvalKey: string
  source: ToolSourceRef
  risk: ToolRisk
  capabilities?: readonly string[]
  sourceLabel?: string
  /**
   * The call asks only because the conversation holds personal data and it may
   * send it somewhere new; allowing it allows the target for the chat
   */
  leakTarget?: string
  /**
   * The call would ask about this target once it runs freely: allowing the call
   * for the chat or for good allows the target too
   */
  coveredLeakTarget?: string
  /**
   * The call asks only because it would keep something past the chat after the
   * conversation took in untrusted content
   */
  isAfterUntrustedContent?: boolean
  /**
   * What "always allow" raises, all of it, so that the call no longer asks;
   * absent when it cannot be offered
   */
  alwaysAllow?: readonly ChatToolAlwaysAllowTarget[]
}

export interface ChatToolRegistryDependencies {
  providers: () => readonly ChatToolProvider[]
  policy: ChatToolPolicy
  /** Logs a tool a provider described wrongly; the rest still work */
  warn?: (message: string) => void
}

/** What the catalog decides a definition by */
const catalogToolOf = (tool: ChatToolDefinition) => ({
  source: tool.source,
  name: tool.catalogName ?? tool.name,
  risk: tool.risk,
  ...(tool.defaultPolicy ? { defaultPolicy: tool.defaultPolicy } : {}),
  ...(tool.isThirdParty ? { isThirdParty: true } : {}),
})

export function createChatToolRegistry(deps: ChatToolRegistryDependencies) {
  /**
   * The tools the request may offer: those not off where they are offered. Null
   * when there are none, so that a chat without tools sends exactly what it
   * always did
   */
  async function resolve(
    context: ChatToolContext
  ): Promise<ChatToolSet | null> {
    const definitions = new Map<string, ChatToolDefinition>()
    const policies = new Map<string, ToolPolicy>()
    const instructions: string[] = []
    for (const provider of deps.providers()) {
      let isOffered = false
      for (const tool of await provider.tools(context)) {
        const state = toolStateIn(context.scope, catalogToolOf(tool))
        if (state === 'off') continue
        if (!TOOL_NAME.test(tool.name) || definitions.has(tool.name)) {
          deps.warn?.(`Chat tool "${tool.name}" of ${provider.id} is skipped`)
          continue
        }
        definitions.set(tool.name, tool)
        policies.set(tool.name, state)
        isOffered = true
      }
      const text = isOffered ? provider.instructions?.(context)?.trim() : ''
      if (text) instructions.push(text)
    }
    if (definitions.size === 0) return null

    const truncatedCallIds = new Set<string>()
    // Reserve before awaiting so parallel calls cannot spend the same budget.
    let remainingCharacters =
      context.outputBudgetCharacters ?? Number.POSITIVE_INFINITY
    const tools: ToolSet = {}
    for (const tool of definitions.values()) {
      tools[tool.name] = dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(
          tool.inputSchema as Parameters<typeof jsonSchema>[0]
        ),
        execute: async (input, { abortSignal, toolCallId }) => {
          const toolLimit = tool.outputLimitCharacters ?? TOOL_OUTPUT_CHARACTERS
          const minCharacters = Math.min(toolLimit, MIN_TOOL_OUTPUT_CHARACTERS)
          const limitCharacters = Math.max(
            minCharacters,
            Math.floor(Math.min(toolLimit, remainingCharacters))
          )
          remainingCharacters -= limitCharacters
          let usedCharacters = 0
          try {
            const output = normalizeToolOutput(
              await tool.execute(input, {
                signal: abortSignal ?? new AbortController().signal,
                toolCallId,
                outputLimitCharacters: limitCharacters,
              }),
              limitCharacters
            )
            usedCharacters = output.text.length
            if (output.isTruncated) truncatedCallIds.add(toolCallId)
            if (tool.readsPersonalData) deps.policy.notePersonalData()
            if (tool.givesKnownUrls) deps.policy.noteKnownText(output.text)
            if (tool.givesUntrustedContent) deps.policy.noteUntrustedContent()
            return output.text
          } finally {
            remainingCharacters += limitCharacters - usedCharacters
          }
        },
      })
    }

    const approvalKey = (toolName: string, input: unknown) =>
      chatToolApprovalKey(
        toolName,
        definitions.get(toolName)?.approvalScope?.(input)
      )

    /** The policy of the tool where it is offered */
    const policyOf = (tool: ChatToolDefinition) =>
      policies.get(tool.name) ?? 'ask'

    /** The call's access by the tool's policy and by its input */
    const accessOf = (tool: ChatToolDefinition, input: unknown) =>
      stricterAccess(policyOf(tool), tool.accessFor?.(input) ?? 'allow')

    /**
     * The target a call asks about because the conversation holds personal
     * data; only where somebody can answer, and not once allowed in the chat
     */
    const leakTargetOf = (tool: ChatToolDefinition, input: unknown) => {
      if (context.scope.kind !== 'profile' || !deps.policy.hasPersonalData())
        return undefined
      const target = tool.leakTarget
        ? tool.leakTarget(input, deps.policy.isKnownUrl)
        : tool.risk === 'external'
          ? toolKey(tool.source, tool.catalogName ?? tool.name)
          : undefined
      return target && !deps.policy.isLeakAllowed(target) ? target : undefined
    }

    /**
     * Whether an allowed call asks since the conversation took in untrusted
     * content
     */
    const asksForUntrustedContent = (
      tool: ChatToolDefinition,
      input: unknown
    ) =>
      context.scope.kind === 'profile' &&
      Boolean(tool.asksAfterUntrustedContent) &&
      deps.policy.hasUntrustedContent() &&
      !deps.policy.isAllowedForSession(approvalKey(tool.name, input))

    const toolApproval: ToolApproval = ({ toolCall }) => {
      const tool = definitions.get(toolCall.toolName)
      if (!tool) return 'denied'
      const access = accessOf(tool, toolCall.input)
      if (
        access === 'allow' &&
        (leakTargetOf(tool, toolCall.input) ||
          asksForUntrustedContent(tool, toolCall.input))
      )
        return 'user-approval'
      return deps.policy.decide(approvalKey(tool.name, toolCall.input), access)
    }

    /**
     * What "always allow" raises so that the call no longer asks: the tool's
     * policy when it asks, and the project when the call's path asks. Nothing
     * when one of them cannot be raised, e.g. a move between two projects
     */
    const alwaysAllowTargetsOf = (
      tool: ChatToolDefinition,
      input: unknown
    ): ChatToolAlwaysAllowTarget[] | undefined => {
      const targets: ChatToolAlwaysAllowTarget[] = []
      if (policyOf(tool) !== 'allow')
        targets.push({
          kind: 'tool',
          source: tool.source,
          toolName: tool.catalogName ?? tool.name,
        })
      if ((tool.accessFor?.(input) ?? 'allow') !== 'allow') {
        const target = tool.alwaysAllowTarget?.(input)
        if (!target) return undefined
        targets.push(target)
      }
      return targets.length ? targets : undefined
    }

    const approvalInfo = (
      toolName: string,
      input: unknown
    ): ChatToolApprovalInfo => {
      const key = approvalKey(toolName, input)
      const tool = definitions.get(toolName)
      if (!tool)
        return {
          approvalKey: key,
          source: { kind: 'core', id: '' },
          risk: 'external',
        }
      const isAllowed = accessOf(tool, input) === 'allow'
      const target = leakTargetOf(tool, input)
      const leakTarget = isAllowed ? target : undefined
      const coveredLeakTarget = isAllowed ? undefined : target
      const isAfterUntrustedContent =
        isAllowed && !leakTarget && asksForUntrustedContent(tool, input)
      // "always allow" is a profile's, and pointless for a call already allowed
      const alwaysAllow =
        context.scope.kind === 'profile' && !isAllowed
          ? alwaysAllowTargetsOf(tool, input)
          : undefined
      return {
        approvalKey: key,
        source: tool.source,
        risk: tool.risk,
        ...(tool.capabilities ? { capabilities: tool.capabilities } : {}),
        ...(tool.sourceLabel ? { sourceLabel: tool.sourceLabel } : {}),
        ...(leakTarget ? { leakTarget } : {}),
        ...(coveredLeakTarget ? { coveredLeakTarget } : {}),
        ...(isAfterUntrustedContent ? { isAfterUntrustedContent } : {}),
        ...(alwaysAllow ? { alwaysAllow } : {}),
      }
    }

    return {
      tools,
      toolApproval,
      definitions,
      truncatedCallIds,
      approvalKey,
      approvalInfo,
      ...(instructions.length
        ? { instructions: instructions.join('\n\n') }
        : {}),
    }
  }

  return { resolve }
}
