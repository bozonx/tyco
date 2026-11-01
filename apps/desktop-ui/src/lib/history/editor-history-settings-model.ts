import { ref } from 'vue'
import type { EditorHistoryConfig } from '@tyco/shared'

import { createHistorySettingsModel } from './history-settings-model'

/** Holds destructive editor policy edits until the user confirms them. */
export function createEditorHistorySettingsModel(deps: {
  getHistory: () => EditorHistoryConfig
  retentionMessage: (days: number) => string
  limitMessage: (count: number) => string
  sessionMessage: () => string
}) {
  const isLimitInvalid = ref(false)
  const typedLimit = ref<number | null>(null)
  const changes = createHistorySettingsModel({
    getRetentionDays: () => deps.getHistory().retentionDays,
    setRetentionDays: (days) => {
      if (days === undefined) delete deps.getHistory().retentionDays
      else deps.getHistory().retentionDays = days
    },
    retentionMessage: deps.retentionMessage,
  })
  function setLimit(value: string) {
    const parsed = Number(value)
    isLimitInvalid.value =
      value.trim() === '' || !Number.isSafeInteger(parsed) || parsed < 1
    if (isLimitInvalid.value) return
    if (parsed < (deps.getHistory().maxItems ?? 1000)) {
      typedLimit.value = parsed
      return
    }
    typedLimit.value = null
    deps.getHistory().maxItems = parsed
  }
  function confirmLowerLimit() {
    const limit = typedLimit.value
    if (limit === null || isLimitInvalid.value) return
    changes.requestChange({
      message: deps.limitMessage(limit),
      apply: () => {
        deps.getHistory().maxItems = limit
        typedLimit.value = null
      },
      cancel: () => {
        typedLimit.value = null
      },
    })
  }
  function setStorage(value: string | number | undefined) {
    if (value !== 'disk' && value !== 'session' && value !== 'off') return
    const apply = () => {
      deps.getHistory().storage = value
    }
    if (value === 'session' && deps.getHistory().storage !== 'session') {
      changes.requestChange({ message: deps.sessionMessage(), apply })
    } else apply()
  }
  return {
    ...changes,
    isLimitInvalid,
    typedLimit,
    setLimit,
    confirmLowerLimit,
    setStorage,
  }
}
