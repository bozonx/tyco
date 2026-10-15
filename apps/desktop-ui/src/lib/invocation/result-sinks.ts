import type {
  Invocation,
  InvocationOptions,
  ResultSink,
} from './invocation-types'

/**
 * Where the output of a run goes. The context decides: an external caller gets
 * it back, the menu and the toolbar show it in the menu; only quick commands
 * follow the preference of the invocation
 */
export function resolveSink(
  invocation: Pick<Invocation, 'launcherSink'>,
  options: Pick<InvocationOptions, 'output' | 'source'> = {}
): ResultSink {
  if (options.output === 'return') return 'return'
  const source = options.source ?? 'menu'
  if (source === 'external') return 'return'
  if ((source !== 'launcher' && source !== 'voice') || !invocation.launcherSink)
    return 'showMenu'
  return invocation.launcherSink.action
}
