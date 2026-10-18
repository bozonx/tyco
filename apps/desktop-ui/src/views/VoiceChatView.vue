<template>
  <ContentPadding>
    <VoiceRecognitionMenu
      v-if="!isInsertMenuVisible"
      variant="sheet"
      finish-behavior="submitToChat"
      activation-mode="voiceChat"
      :context="context?.text"
      @remove-context="contextRemoved = true"
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
    <!-- Tab: the user wants another action for the text, not the chat -->
    <InsertMenu
      v-else
      :text="dictationResultText"
      :allowInsertButton="true"
      :shortcutsDisabled="menuModalsStore.hasOpenModal"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import InsertMenu from '../components/menu/InsertMenu.vue'
import VoiceRecognitionMenu from '../components/menu/VoiceRecognitionMenu.vue'
import { useVoiceResultStep } from '../composables/use-voice-result-step'
import type { VoiceFinishIntent } from '../lib/stt/voice-finish-intent'
import { useChatStore } from '../stores/chat'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'

const ipcStore = useIpcStore()

const desktopStore = useDesktopStore()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()
const menuModalsStore = useMenuModalsStore()

navPanelStore.resetNavPanelState({ panelVisible: false })

/** The user removed the context of this activation */
const contextRemoved = ref(false)
/** The dictated text went to the actions step instead of the chat */
const { isInsertMenuVisible, dictationResultText, showResult, resetResult } =
  useVoiceResultStep(() => 'voiceChat')

watch(
  () => desktopStore.desktopState.activationId,
  () => {
    contextRemoved.value = false
    resetResult()
  }
)
/** What the question is about; it is shown before it goes to the chat */
const context = computed(() =>
  contextRemoved.value ? null : chatStore.voiceChatContext
)

async function handleCorrected(
  resultText: string,
  _recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  if (intent === 'next') {
    showResult(resultText)
    return
  }

  const autoSend = intent === 'submit'

  const activationId = desktopStore.desktopState.activationId
  const result = await ipcStore.callFunctionOrNotify('openMainChat', [
    context.value ?? undefined,
    resultText,
    autoSend,
  ])
  if (
    !result.success &&
    desktopStore.desktopState.activationId === activationId &&
    desktopStore.desktopState.mode === 'voiceChat' &&
    desktopStore.desktopState.isWindowShown
  ) {
    showResult(resultText)
  }
}

async function handleCancelled() {
  await ipcStore.callFunction('dismissQuickWindow')
}
</script>
