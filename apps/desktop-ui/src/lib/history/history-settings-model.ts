import { shallowRef } from 'vue'

import { isStricterRetention } from './history-retention'

interface PendingHistoryChange {
  message: string
  apply: () => void
  cancel?: () => void
}

/** Changes that remove stored history wait for explicit confirmation. */
export function createHistorySettingsModel(deps: {
  getRetentionDays: () => number | undefined
  setRetentionDays: (days: number | undefined) => void
  retentionMessage: (days: number) => string
}) {
  const pendingChange = shallowRef<PendingHistoryChange | null>(null)
  const cancelChange = () => {
    pendingChange.value?.cancel?.()
    pendingChange.value = null
  }
  const requestChange = (change: PendingHistoryChange) => {
    cancelChange()
    pendingChange.value = change
  }
  const confirmChange = () => {
    const change = pendingChange.value
    pendingChange.value = null
    change?.apply()
  }
  const setRetentionDays = (value: number | string | undefined) => {
    if (value === undefined || value === '') return
    const days = Number(value)
    if (!Number.isSafeInteger(days) || days < 0) return
    const apply = () => deps.setRetentionDays(days || undefined)
    if (isStricterRetention(deps.getRetentionDays(), days)) {
      requestChange({ message: deps.retentionMessage(days), apply })
    } else apply()
  }
  return {
    pendingChange,
    requestChange,
    confirmChange,
    cancelChange,
    setRetentionDays,
  }
}
