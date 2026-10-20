<template>
  <!-- the bar sits at the bottom like the quick input, without padding -->
  <div v-if="props.bar && !isInsertMenuVisible" class="voice-bar-layer">
    <VoiceRecognitionMenu
      variant="bar"
      finish-behavior="insertIntoTarget"
      :activation-mode="activationMode"
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
  </div>
  <ContentPadding v-else>
    <VoiceRecognitionMenu
      v-if="!isInsertMenuVisible"
      finish-behavior="insertIntoTarget"
      :activation-mode="activationMode"
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
    <InsertMenu
      v-else
      :text="dictationResultText"
      :allow-insert-button="true"
      :shortcuts-disabled="menuModalsStore.hasOpenModal"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { watch } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import InsertMenu from '../components/menu/InsertMenu.vue'
import VoiceRecognitionMenu from '../components/menu/VoiceRecognitionMenu.vue'
import { useVoiceResultStep } from '../composables/use-voice-result-step'
import { isQuickWindow } from '../lib/desktop/window'
import { APP_ROUTES } from '../lib/navigation/routes'
import type { VoiceFinishIntent } from '../lib/stt/voice-finish-intent'
import { appNavigation } from '../navigation'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
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

navPanelStore.resetNavPanelState({ panelVisible: false })

/** Only the quick window is opened by the `voice` activation */
const activationMode = isQuickWindow() ? ('voice' as const) : undefined
const { isInsertMenuVisible, dictationResultText, showResult, resetResult } =
  useVoiceResultStep(() => activationMode)

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
    if (!isShown || mode !== 'voice' || activationId !== previous?.[2]) {
      resetResult()
    }
  }
)

function handleCorrected(
  resultText: string,
  _recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  const insertAction = actionMenuStore
    .getDefaultActions()
    .find((action) => action.id === 'insertIntoWindow')
  // without a target window the text stays in the actions step, not lost
  if (
    intent !== 'next' &&
    insertAction &&
    desktopStore.desktopState?.windowId
  ) {
    void insertAction.action(resultText)
    return
  }
  showResult(resultText)
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
