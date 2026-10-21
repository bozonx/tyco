import type {
  Invocation,
  InvocationOptions,
  ResultSink,
} from './invocation-types'

/**
 * Where the output of a run goes. The context decides: an external caller gets
 * it back, the menu and the toolbar show it in the menu; only quick commands
 * follow the output action of the command. Voice translations always open the
 * result menu so the user chooses what to do with the translated text.
 */
export function resolveSink(
  invocation: Pick<Invocation, 'outputAction'> &
    Partial<Pick<Invocation, 'toolId'>>,
  options: Pick<InvocationOptions, 'output' | 'source'> = {}
): ResultSink {
  if (options.output) return options.output
  const source = options.source ?? 'menu'
  if (source === 'external') return 'return'
  if (source === 'voice' && invocation.toolId === 'core.translate')
    return 'showMenu'
  if ((source !== 'launcher' && source !== 'voice') || !invocation.outputAction)
    return 'showMenu'
  return invocation.outputAction
}
