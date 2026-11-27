<template>
  <div />
</template>

<script setup lang="ts">
import { onMounted, onScopeDispose } from 'vue'

import { desktopClient } from './lib/desktop/client'
import { clientLogger } from './lib/logger'
import { useDesktopStore } from './stores/desktop'
import { useQuietRunStore } from './stores/quiet-run'
import { DESKTOP_EVENTS } from '@tyco/shared'

const quietRun = useQuietRunStore()
const desktop = useDesktopStore()
const listeners: (() => void)[] = []
let disposed = false

onMounted(async () => {
  try {
    await desktop.loadDesktopState()
    if (disposed) return
    quietRun.startExecutor()
    const subscribe = async (subscription: Promise<() => void>) => {
      const stop = await subscription
      if (disposed) stop()
      else listeners.push(stop)
    }
    await Promise.all([
      subscribe(
        desktopClient.listen(DESKTOP_EVENTS.QUIET_RUN_CHANGED, quietRun.update)
      ),
      subscribe(
        desktopClient.listen(
          DESKTOP_EVENTS.EXTERNAL_JOB_CANCEL,
          quietRun.abortExecution
        )
      ),
    ])
    if (!disposed) await quietRun.refresh()
  } catch (error) {
    clientLogger.error('Could not start the background executor', error)
  }
})
onScopeDispose(() => {
  disposed = true
  for (const stop of listeners) stop()
})
</script>
