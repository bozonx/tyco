import { validateToolResult } from './contributions.js'
import {
  isPluginCancellation,
  isPluginError,
  type PluginContext,
} from './plugin.js'
import { resolveToolInput } from './tool-input.js'
import type { ToolDefinition } from './tools.js'

/**
 * Runs a tool of the plugin from a menu action: on `text`, with the plugin
 * settings, without a command. The result goes to a toast
 */
export async function runToolFromAction(
  ctx: PluginContext,
  tool: ToolDefinition,
  text: string
): Promise<void> {
  try {
    const config = ctx.getMyConfig<Record<string, unknown>>() ?? {}
    const parsed = await resolveToolInput({
      tool,
      config,
      text,
      context: { now: new Date(), signal: ctx.signal },
    })
    if (ctx.signal.aborted) return
    const result = parsed.ok
      ? await tool.run({
          input: parsed.input,
          config,
          source: 'menu',
          signal: ctx.signal,
          isOutputRequested: false,
          wantsOutput: false,
        })
      : parsed
    validateToolResult(result)
    if (('cancelled' in result && result.cancelled) || ctx.signal.aborted)
      return
    const level =
      ('level' in result ? result.level : undefined) ??
      (result.ok ? 'success' : 'error')
    if (result.messageKey) ctx.toast(result.messageKey, level)
    else if (result.message) ctx.toastText(result.message, level)
  } catch (error) {
    if (ctx.signal.aborted || isPluginCancellation(error)) return
    if (isPluginError(error)) {
      ctx.toast(error.messageKey, 'error')
      return
    }
    ctx.log('error', 'Action tool failed', error)
    ctx.toast('toast.commandFailed', 'error')
  }
}

/**
 * Runs a tool of the plugin from its toolbar button: on the selection or the
 * whole text of the editor, with the plugin settings, without a command. The
 * result goes to a toast
 */
export async function runToolFromToolbar(
  ctx: PluginContext,
  tool: ToolDefinition
): Promise<void> {
  try {
    const editorSnapshot = await ctx.getEditorInputSnapshot()
    const text = editorSnapshot.selectedText.trim()
      ? editorSnapshot.selectedText
      : editorSnapshot.value
    const config = ctx.getMyConfig<Record<string, unknown>>() ?? {}
    const parsed = await resolveToolInput({
      tool,
      config,
      text,
      context: { now: new Date(), signal: ctx.signal },
    })
    if (ctx.signal.aborted) return
    const result = parsed.ok
      ? await tool.run({
          input: parsed.input,
          config,
          source: 'toolbar',
          editorSnapshot,
          signal: ctx.signal,
          isOutputRequested: false,
          wantsOutput: false,
        })
      : parsed
    validateToolResult(result)
    if (('cancelled' in result && result.cancelled) || ctx.signal.aborted)
      return
    const level =
      ('level' in result ? result.level : undefined) ??
      (result.ok ? 'success' : 'error')
    if (result.messageKey) ctx.toast(result.messageKey, level)
    else if (result.message) ctx.toastText(result.message, level)
  } catch (error) {
    if (ctx.signal.aborted || isPluginCancellation(error)) return
    if (isPluginError(error)) {
      ctx.toast(error.messageKey, 'error')
      return
    }
    ctx.log('error', 'Toolbar tool failed', error)
    ctx.toast('toast.commandFailed', 'error')
  }
}
