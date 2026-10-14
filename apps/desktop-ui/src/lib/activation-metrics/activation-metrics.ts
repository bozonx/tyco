import { createCleanupScope } from '../app/cleanup-scope'

export interface ActivationMetricsDependencies {
  listen: (
    event: 'start' | 'collect',
    handler: (payload: { id: number }) => void
  ) => Promise<() => void>
  mark: (id: number, mark: 'frame' | 'dom-focus' | 'first-char') => void
  submitValue: (id: number) => void
  prepareTrial: () => void
  activeElement: () => EventTarget | null
  requestFrame: (handler: () => void) => void
  eventTarget: Pick<Document, 'addEventListener' | 'removeEventListener'>
}

export function createActivationMetricsClient(
  deps: ActivationMetricsDependencies
) {
  let activeId: number | null = null
  let firstCharacterMarked = false
  let scope = createCleanupScope()
  let starting: Promise<void> | undefined

  // the main window edits in CodeMirror, the quick window in a textarea
  const isEditorTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('.cm-editor, textarea, [contenteditable="true"]'))

  const onFocus = (event: Event) => {
    if (activeId !== null && isEditorTarget(event.target)) {
      deps.mark(activeId, 'dom-focus')
    }
  }
  const onKeydown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent
    if (
      activeId !== null &&
      !firstCharacterMarked &&
      isEditorTarget(event.target) &&
      keyboardEvent.key.length === 1 &&
      !keyboardEvent.ctrlKey &&
      !keyboardEvent.altKey &&
      !keyboardEvent.metaKey
    ) {
      firstCharacterMarked = true
      deps.mark(activeId, 'first-char')
    }
  }

  return {
    start(): Promise<void> {
      if (starting) return starting
      if (scope.stopped) scope = createCleanupScope()
      const run = scope
      const work = async () => {
        try {
          run.add(
            await deps.listen('start', ({ id }) => {
              if (run.stopped) return
              deps.prepareTrial()
              activeId = id
              firstCharacterMarked = false
              if (isEditorTarget(deps.activeElement()))
                deps.mark(id, 'dom-focus')
              deps.requestFrame(() => {
                if (!run.stopped) deps.mark(id, 'frame')
              })
            })
          )
          if (run.stopped) return
          run.add(
            await deps.listen('collect', ({ id }) => {
              if (!run.stopped) deps.submitValue(id)
            })
          )
          if (run.stopped) return
          deps.eventTarget.addEventListener('focusin', onFocus)
          deps.eventTarget.addEventListener('keydown', onKeydown, true)
          run.add(() => {
            deps.eventTarget.removeEventListener('focusin', onFocus)
            deps.eventTarget.removeEventListener('keydown', onKeydown, true)
          })
        } catch (error) {
          run.stop()
          throw error
        }
      }
      starting = work().catch((error: unknown) => {
        starting = undefined
        throw error
      })
      return starting
    },
    stop() {
      scope.stop()
      starting = undefined
      activeId = null
    },
  }
}
