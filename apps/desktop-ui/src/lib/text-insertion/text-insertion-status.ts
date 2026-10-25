import type {
  IpcResult,
  KeySender,
  TextInsertionProblem,
  TextInsertionStatus,
} from '@tyco/shared'
import { ref } from 'vue'

export interface TextInsertionStatusDependencies {
  getStatus: () => Promise<IpcResult<TextInsertionStatus>>
  requestPermission: () => Promise<IpcResult<TextInsertionStatus>>
}

export type InsertionStatusTone = 'ok' | 'warning' | 'error'

/** One line of the insertion status, as the settings show it */
export interface InsertionStatusLine {
  tone: InsertionStatusTone
  messageKey: string
}

const READY_KEYS: Record<KeySender, string> = {
  ydotool: 'settings.textInsertion.keysReadyYdotool',
  portal: 'settings.textInsertion.keysReadyPortal',
  system: 'settings.textInsertion.keysReadySystem',
}

const PROBLEM_KEYS: Record<TextInsertionProblem, string> = {
  unsupportedSession: 'settings.textInsertion.unsupportedSession',
  ydotoolMissing: 'settings.textInsertion.ydotoolMissing',
  ydotoolOutdated: 'settings.textInsertion.ydotoolOutdated',
  ydotooldNotRunning: 'settings.textInsertion.ydotooldNotRunning',
  portalUnavailable: 'settings.textInsertion.portalUnavailable',
  accessibilityDenied: 'settings.textInsertion.accessibilityDenied',
}

/** How keys get pressed in other windows, or what keeps them from it */
export function describeKeys(status: TextInsertionStatus): InsertionStatusLine {
  if (status.keys === 'ready') {
    return { tone: 'ok', messageKey: READY_KEYS[status.keySender ?? 'system'] }
  }
  if (status.keys === 'needsPermission') {
    return {
      tone: 'warning',
      messageKey: 'settings.textInsertion.portalNeedsPermission',
    }
  }
  return {
    tone: 'error',
    messageKey: status.problem
      ? PROBLEM_KEYS[status.problem]
      : 'settings.textInsertion.keysUnavailable',
  }
}

/** How the window to insert into is found */
export function describeTarget(
  status: TextInsertionStatus
): InsertionStatusLine {
  return status.target === 'tracked'
    ? { tone: 'ok', messageKey: 'settings.textInsertion.targetTracked' }
    : {
        tone: 'warning',
        messageKey: 'settings.textInsertion.targetFocusReturn',
      }
}

/** The insertion status of the settings page, checked whenever it opens */
export function createTextInsertionStatusModel(
  deps: TextInsertionStatusDependencies
) {
  const status = ref<TextInsertionStatus | null>(null)
  const error = ref('')
  const isRequesting = ref(false)

  const apply = (result: IpcResult<TextInsertionStatus>) => {
    if (result.success) {
      status.value = result.result
      error.value = ''
    } else {
      error.value = result.error
    }
  }

  const refresh = async () => {
    apply(await deps.getStatus())
  }

  /** Shows the desktop's permission dialog, then the new status */
  const requestPermission = async () => {
    isRequesting.value = true
    try {
      apply(await deps.requestPermission())
    } finally {
      isRequesting.value = false
    }
  }

  return { status, error, isRequesting, refresh, requestPermission }
}
