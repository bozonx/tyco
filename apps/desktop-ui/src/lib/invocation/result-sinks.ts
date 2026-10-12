import type {
  Invocation,
  InvocationOptions,
  ResultSink,
} from './invocation-types'

/**
 * Where the output of a run goes. The context decides: an external caller gets
 * it back, the menu and the toolbar show it in the menu; only quick commands
 * follow the preference of the invocation, which falls back when there is no
 * selection to replace
 */
export function resolveSink(
  invocation: Pick<Invocation, 'launcherSink'>,
  options: Pick<InvocationOptions, 'output' | 'source' | 'hasSelection'> = {}
): ResultSink {
  if (options.output === 'return') return 'return'
  const source = options.source ?? 'menu'
  if (source === 'external') return 'return'
  if (source !== 'launcher' || !invocation.launcherSink) return 'showMenu'
  const { action, fallback } = invocation.launcherSink
  return action === 'replaceSelection' && !options.hasSelection
    ? fallback
    : action
}
