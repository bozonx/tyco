<template>
  <ContentPadding>
    <VoiceRecognitionMenu
      variant="sheet"
      quick-send
      :context="context"
      @remove-context="contextRemoved = true"
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import VoiceRecognitionMenu from '../components/menu/VoiceRecognitionMenu.vue'
import type { VoiceFinishIntent } from '../lib/stt/voice-finish-intent'
import { useChatStore } from '../stores/chat'
import { useIpcStore } from '../stores/ipc'
import { useNavPanelStore } from '../stores/navPanel'

const ipcStore = useIpcStore()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()

navPanelStore.resetNavParams({ panelVisible: false })

/** The user removed the context of this activation */
const contextRemoved = ref(false)
watch(
  () => ipcStore.params.activationId,
  () => {
    contextRemoved.value = false
  }
)
/** What the question is about; it is shown before it goes to the chat */
const context = computed(() =>
  contextRemoved.value ? '' : chatStore.voiceChatContext
)

async function handleCorrected(
  resultText: string,
  _recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  const autoSend = intent === 'submit'

  await ipcStore.callFunction('openMainChat', [
    context.value || undefined,
    resultText,
    autoSend,
  ])
  await ipcStore.callFunction('dismissQuickWindow')
}

async function handleCancelled() {
  await ipcStore.callFunction('dismissQuickWindow')
}
</script>
