import {
  createChatFileDropTarget,
  type FileDropEvent,
} from './chat-file-drop-target'

/** Releases pending native registrations even when the component has gone. */
export function createChatFileDropListener(
  deps: Parameters<typeof createChatFileDropTarget>[0] & {
    subscribe: (handler: (event: FileDropEvent) => void) => Promise<() => void>
    reportError: (message: string, error: unknown) => void
  }
) {
  const target = createChatFileDropTarget(deps)
  let disposed = false
  let unlisten: (() => void) | undefined
  let starting: Promise<void> | undefined
  return {
    start(): Promise<void> {
      if (disposed) return Promise.resolve()
      if (starting) return starting
      starting = deps
        .subscribe((event) => {
          void target
            .handle(event)
            .catch((error) =>
              deps.reportError('Failed to import dropped chat files', error)
            )
        })
        .then((cleanup) => {
          if (disposed) cleanup()
          else unlisten = cleanup
        })
        .catch((error) => {
          deps.reportError('Failed to register chat file drop listener', error)
        })
      return starting
    },
    dispose() {
      if (disposed) return
      disposed = true
      target.dispose()
      unlisten?.()
      unlisten = undefined
    },
  }
}
