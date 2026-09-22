<template>
  <ContentPadding>
    <InProgressMessage v-if="isStarting" correction />
  </ContentPadding>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import InProgressMessage from '../components/menu/InProgressMessage.vue'
import { createCorrectionMode } from '../lib/correction-mode/correction-mode'
import { useActionMenuStore } from '../stores/actionMenu'
import { useIpcStore } from '../stores/ipc'
import { useNavPanelStore } from '../stores/navPanel'

const actionMenuStore = useActionMenuStore()
const ipcStore = useIpcStore()
const navPanelStore = useNavPanelStore()
const isStarting = ref(false)

navPanelStore.resetNavParams({ panelVisible: false })

const correctionMode = createCorrectionMode({
  startCorrection: async (text) => {
    const correction = actionMenuStore
      .getDefaultActions()
      .find((action) => action.id === 'correction')
    await correction?.action(text)
  },
  setPending: (pending) => {
    isStarting.value = pending
  },
})

watch(
  () => ipcStore.params.selectedText,
  (text) => void correctionMode.consume(text),
  { immediate: true }
)
</script>
