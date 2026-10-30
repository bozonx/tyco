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
      :old-text="dictationOldText"
      :allow-insert-button="true"
      :shortcuts-disabled="menuModalsStore.hasOpenModal"
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
import { useActionMenuStore } from '../stores/action-menu'
import { useChatStore } from '../stores/chat'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import { useWindowStore } from '../stores/window'

const ipcStore = useIpcStore()

const actionMenuStore = useActionMenuStore()
const desktopStore = useDesktopStore()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()
const menuModalsStore = useMenuModalsStore()
const windowStore = useWindowStore()

navPanelStore.resetNavPanelState({ panelVisible: false })

/** The user removed the context of this activation */
const contextRemoved = ref(false)
/** The dictated text went to the actions step instead of the chat */
const {
  isInsertMenuVisible,
  dictationResultText,
  dictationOldText,
  showResult,
  resetResult,
} = useVoiceResultStep(() => 'voiceChat')

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
  recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  if (intent === 'copy') {
    const copyAction = actionMenuStore
      .getDefaultActions()
      .find((action) => action.id === 'copyToClipboard')
    void copyAction?.action(resultText)
    return
  }
  if (intent === 'next') {
    showResult(resultText, recognizedText !== resultText ? recognizedText : '')
    return
  }

  const autoSend = intent === 'submit'

  const activationId = desktopStore.desktopState.activationId
  const result = await ipcStore.callOrNotify('open_main_chat', {
    attachment: context.value ?? undefined,
    question: resultText,
    autoSend,
  })
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
  await windowStore.hide()
}
</script>
