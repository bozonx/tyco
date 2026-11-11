<template>
  <!-- the bar sits at the bottom like the quick input, without padding -->
  <div v-if="props.bar && !isInsertMenuVisible" class="voice-bar-layer">
    <VoiceRecognitionMenu
      variant="bar"
      target="external"
      finish-behavior="insertIntoTarget"
      :activation-mode="activationMode"
      :reply-to="replyTo"
      :can-switch-mode="isQuickWindow()"
      :keep-error-visible="isQuickWindow()"
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
  </div>
  <ContentPadding v-else>
    <VoiceRecognitionMenu
      v-if="!isInsertMenuVisible"
      target="external"
      finish-behavior="insertIntoTarget"
      :activation-mode="activationMode"
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
    <template v-else>
      <InsertMenu
        :text="dictationResultText"
        :reply-to="replyTo"
        :old-text="dictationOldText"
        :allow-insert-button="true"
        :shortcuts-disabled="menuModalsStore.hasOpenModal"
      />
    </template>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import InsertMenu from '../components/menu/InsertMenu.vue'
import VoiceRecognitionMenu from '../components/menu/VoiceRecognitionMenu.vue'
import { useEditorNavigation } from '../composables/use-editor-navigation'
import { useVoiceResultStep } from '../composables/use-voice-result-step'
import { isQuickWindow } from '../lib/desktop/window'
import { voiceReplyActionParams } from '../lib/listen/listen-reply-actions'
import { APP_ROUTES } from '../lib/navigation/routes'
import type { VoiceFinishIntent } from '../lib/stt/voice-finish-intent'
import { appNavigation } from '../navigation'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useListenReplyStore } from '../stores/listen-reply'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import { useVoiceResultStore } from '../stores/voice-result'
import { useWindowStore } from '../stores/window'

const props = withDefaults(
  defineProps<{
    /** Dictate in a bar at the bottom of the screen, as the quick window does */
    bar?: boolean
  }>(),
  { bar: false }
)

const emit = defineEmits<{
  /** The dictation is over and its result is shown in the insert menu */
  (e: 'result-shown', shown: boolean): void
}>()

const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const windowStore = useWindowStore()
const desktopStore = useDesktopStore()
const actionMenuStore = useActionMenuStore()
const editorNavigation = useEditorNavigation()

navPanelStore.resetNavPanelState({ panelVisible: false })
const listenReplyStore = useListenReplyStore()
/** The listened message this dictation answers, see "Reply by voice" */
const replyTo = computed(() =>
  isQuickWindow()
    ? listenReplyStore.contextFor(desktopStore.desktopState.activationId)
    : undefined
)

/** Only the quick window is opened by the `voice` activation */
const activationMode = isQuickWindow() ? ('voice' as const) : undefined
const {
  isInsertMenuVisible,
  dictationResultText,
  dictationOldText,
  showResult,
  resetResult,
} = useVoiceResultStep(
  () => activationMode,
  // the quick window keeps the result until the user takes or drops it
  isQuickWindow() ? useVoiceResultStore().step : undefined
)

watch(isInsertMenuVisible, (shown) => emit('result-shown', shown), {
  immediate: true,
})

watch(
  () => [
    desktopStore.desktopState?.isWindowShown,
    desktopStore.desktopState?.mode,
    desktopStore.desktopState.activationId,
  ],
  ([isShown, mode, activationId], previous) => {
    // the quick window keeps an untaken result, see `useVoiceResultStore`
    if (isQuickWindow()) return
    if (!isShown || mode !== 'voice' || activationId !== previous?.[2]) {
      resetResult()
    }
  }
)

function handleCorrected(
  resultText: string,
  recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  if (intent === 'copy') {
    void actionMenuStore.runDefaultAction('copyToClipboard', resultText)
    return
  }
  if (intent === 'editor') {
    editorNavigation.toEditor(resultText)
    return
  }
  if (typeof intent === 'object' && intent !== null) {
    showResult(resultText, recognizedText !== resultText ? recognizedText : '')
    const slotAction = actionMenuStore.getShortcutActions()[intent.slotIndex]
    if (slotAction && !slotAction.disabled) {
      const replyParams = voiceReplyActionParams(
        slotAction.id,
        resultText,
        replyTo.value
      )
      if (replyParams)
        menuModalsStore.nextModal(MenuModals.QUICK_AI_REQUEST, replyParams)
      else void slotAction.action(resultText)
    }
    return
  }
  const insertAction = actionMenuStore
    .getDefaultActions()
    .find((action) => action.id === 'insertIntoWindow')
  // without a target window the text stays in the actions step, not lost
  if (intent !== 'next' && insertAction && desktopStore.canInsertIntoWindow) {
    void insertAction.action(resultText)
    return
  }
  showResult(resultText, recognizedText !== resultText ? recognizedText : '')
}

function handleCancelled() {
  if (
    !desktopStore.desktopState.isWindowShown ||
    desktopStore.desktopState.mode !== 'voice'
  )
    return

  if (isQuickWindow()) {
    void windowStore.hide()
  } else {
    void appNavigation.push(APP_ROUTES.EDITOR.path)
  }
}
</script>

<style scoped>
.voice-bar-layer {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  width: 100%;
  height: 100%;
}
</style>
