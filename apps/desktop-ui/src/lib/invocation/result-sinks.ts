import type {
  Invocation,
  InvocationOptions,
  ResultSink,
} from './invocation-types'

/**
 * Where the output of a run goes. The context decides: an external caller gets
 * it back, the toolbar shows it in the menu; commands and voice actions follow
 * the output action of the command, unless the caller asks for another one.
 */
export function resolveSink(
  invocation: Pick<Invocation, 'outputAction'>,
  options: Pick<InvocationOptions, 'output' | 'source'> = {}
): ResultSink {
  if (options.output) return options.output
  const source = options.source ?? 'menu'
  if (source === 'external') return 'return'
  if (source === 'toolbar' || !invocation.outputAction) return 'showMenu'
  return invocation.outputAction
}
