<template>
  <ContentPadding>
    <VoiceRecognitionMenu
      v-if="!isInsertMenuVisible"
      variant="sheet"
      finish-behavior="submitToChat"
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
import type { VoiceFinishIntent } from '../lib/stt/voice-finish-intent'
import { useChatStore } from '../stores/chat'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'

const ipcStore = useIpcStore()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()
const menuModalsStore = useMenuModalsStore()

navPanelStore.resetNavPanelState({ panelVisible: false })

/** The user removed the context of this activation */
const contextRemoved = ref(false)
/** The dictated text went to the actions step instead of the chat */
const isInsertMenuVisible = ref(false)
const dictationResultText = ref('')
watch(
  () => ipcStore.desktopState.activationId,
  () => {
    contextRemoved.value = false
    isInsertMenuVisible.value = false
    dictationResultText.value = ''
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
    dictationResultText.value = resultText
    isInsertMenuVisible.value = true
    return
  }

  const autoSend = intent === 'submit'

  const activationId = ipcStore.desktopState.activationId
  const result = await ipcStore.callFunctionOrNotify('openMainChat', [
    context.value ?? undefined,
    resultText,
    autoSend,
  ])
  if (
    !result.success &&
    ipcStore.desktopState.activationId === activationId &&
    ipcStore.desktopState.mode === 'voiceChat' &&
    ipcStore.desktopState.isWindowShown
  ) {
    dictationResultText.value = resultText
    isInsertMenuVisible.value = true
  }
}

async function handleCancelled() {
  await ipcStore.callFunction('dismissQuickWindow')
}
</script>
