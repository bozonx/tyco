export interface ActivationMetricsDeps {
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

export function createActivationMetricsClient(deps: ActivationMetricsDeps) {
  let activeId: number | null = null
  let firstCharacterMarked = false
  const stops: (() => void)[] = []

  const isEditorTarget = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest('.cm-editor'))

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
    async start() {
      stops.push(
        await deps.listen('start', ({ id }) => {
          deps.prepareTrial()
          activeId = id
          firstCharacterMarked = false
          if (isEditorTarget(deps.activeElement())) {
            deps.mark(id, 'dom-focus')
          }
          deps.requestFrame(() => deps.mark(id, 'frame'))
        }),
        await deps.listen('collect', ({ id }) => deps.submitValue(id))
      )
      deps.eventTarget.addEventListener('focusin', onFocus)
      deps.eventTarget.addEventListener('keydown', onKeydown, true)
    },
    stop() {
      stops.splice(0).forEach((stop) => stop())
      deps.eventTarget.removeEventListener('focusin', onFocus)
      deps.eventTarget.removeEventListener('keydown', onKeydown, true)
      activeId = null
    },
  }
}
