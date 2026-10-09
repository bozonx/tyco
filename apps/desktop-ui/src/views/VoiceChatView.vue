<template>
  <ContentPadding>
    <VoiceRecognitionMenu
      variant="sheet"
      quick-send
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import VoiceRecognitionMenu from '../components/menu/VoiceRecognitionMenu.vue'
import type { VoiceFinishIntent } from '../lib/stt/voice-finish-intent'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { useNavPanelStore } from '../stores/navPanel'

const ipcStore = useIpcStore()
const navPanelStore = useNavPanelStore()
const editorInputStore = useEditorInputStore()

navPanelStore.resetNavParams({ panelVisible: false })

async function handleCorrected(
  resultText: string,
  _recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  const context =
    ipcStore.params?.selectedText ||
    editorInputStore.selectedText ||
    editorInputStore.value ||
    undefined
  const autoSend = intent === 'submit'

  await ipcStore.callFunction('openMainChat', [context, resultText, autoSend])
  await ipcStore.callFunction('dismissQuickWindow')
}

async function handleCancelled() {
  await ipcStore.callFunction('dismissQuickWindow')
}
</script>
