import type { PluginContext, ToolDefinition } from '../../types/plugins'

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
  const result = await tool.run({
    input: { text },
    config: ctx.getMyConfig<Record<string, unknown>>() ?? {},
    source: 'toolbar',
    signal: new AbortController().signal,
    wantsOutput: false,
  })
  if (result.cancelled) return
  const level = result.level ?? (result.ok ? 'success' : 'error')
  if (result.messageKey) ctx.toast(result.messageKey, level)
  else if (result.message) ctx.toast(result.message, level)
}
