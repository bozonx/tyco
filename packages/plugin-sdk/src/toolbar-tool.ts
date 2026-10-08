import type { PluginContext } from './plugin.js'
import type { ToolDefinition } from './tools.js'

/**
 * Runs a tool of the plugin from its toolbar button: on the selection or the
 * whole text of the editor, with the plugin settings, without a command. The
 * result goes to a toast
 */
export async function runToolFromToolbar(
  ctx: PluginContext,
  tool: ToolDefinition
): Promise<void> {
  const text =
    ctx.getEditorInputSelectedText() || ctx.getEditorInputValue() || ''
  try {
    const result = await tool.run({
      input: { text },
      config: ctx.getMyConfig<Record<string, unknown>>() ?? {},
      source: 'toolbar',
      signal: ctx.signal,
      wantsOutput: false,
    })
    if (result.cancelled || ctx.signal.aborted) return
    const level = result.level ?? (result.ok ? 'success' : 'error')
    if (result.messageKey) ctx.toast(result.messageKey, level)
    else if (result.message) ctx.toastText(result.message, level)
  } catch (error) {
    if (ctx.signal.aborted) return
    ctx.log('error', 'Toolbar tool failed', error)
    ctx.toast('toast.commandFailed', 'error')
  }
}
