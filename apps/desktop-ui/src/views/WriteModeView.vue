<template>
  <ContentPadding>
    <div class="write-mode-container">
      <div class="write-frame">
        <WriteModeInput class="flex-1" />
        <div class="write-rail">
          <Button sm ghost square @click="clear" :title="t('editor.clear')">
            <Icon icon="mdi:eraser" height="18" />
          </Button>
        </div>
      </div>
      <p class="write-hint">
        <KeyButton>Esc</KeyButton>
        <span>{{ t('write.next') }}</span>
        <span class="opacity-40">•</span>
        <KeyButton>Tab</KeyButton>
        <span>{{ t('shortcuts.insertIntoEditor') }}</span>
      </p>
    </div>
  </ContentPadding>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useCallAi } from '../composables/useCallAi'
import { GlobalEvents, useGlobalEvents } from '../composables/useGlobalEvents'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'
import { useWriterInputStore } from '../stores/writerInput'
import { Icon } from '@iconify/vue'

const navPanelStore = useNavPanelStore()
const writerInputStore = useWriterInputStore()
const routeParamsStore = useRouteParams()
const { globalEvents } = useGlobalEvents()
const ipcStore = useIpcStore()
const { correctText } = useCallAi()
const menuModalsStore = useMenuModalsStore()
const historyStore = useHistoryStore()
const { toast } = useToast()
const appConfig = ipcStore.params!.appConfig
const correctedText = ref('')
const correctionIsActual = ref(true)
const { t } = useI18n()
let keyUpListenerIndex = -1

function resetNav() {
  navPanelStore.resetNavParams({
    escBtnLabelKey: 'write.next',
    escBtnAction: doCorrection,
    panelVisible: false,
  })
}

resetNav()

watch(
  () => [ipcStore.params?.isWindowShown, ipcStore.params?.mode],
  ([isShown, mode]) => {
    if (isShown && mode === 'write') {
      resetNav()
      writerInputStore.focus()
    }
  },
  { immediate: true }
)

watch(
  () => writerInputStore.value,
  () => {
    correctionIsActual.value = false
  }
)

function handleKeyUp(event: KeyboardEvent) {
  if (event.code === 'Tab' && !menuModalsStore.anyModalOpen) {
    event.preventDefault()
    routeParamsStore.toEditor(writerInputStore.value)
  }
}

onMounted(() => {
  keyUpListenerIndex = globalEvents.addListener(
    GlobalEvents.KEY_UP,
    handleKeyUp
  )
})

onUnmounted(() => {
  if (keyUpListenerIndex >= 0) {
    globalEvents.removeListener(keyUpListenerIndex)
    keyUpListenerIndex = -1
  }
})

const clear = () => {
  writerInputStore.clear()
  writerInputStore.focus()
}

async function doCorrection() {
  if (!writerInputStore.value?.trim()) {
    toast(t('write.enterTextForCorrection'), 'warn')
    return
  } else if (correctionIsActual.value) {
    toast(t('write.alreadyCorrected'), 'warn')
  } else if (writerInputStore.value.length < appConfig.minCorrectionLength) {
    toast(t('write.textTooShortForCorrection'), 'warn')

    correctedText.value = writerInputStore.value
    correctionIsActual.value = true
  } else {
    const sourceId = await historyStore.saveSource(
      writerInputStore.value,
      'correction'
    )
    menuModalsStore.setPendingModal({ correction: true })
    try {
      const result = await correctText(writerInputStore.value)
      await historyStore.saveSourceResult(sourceId, result).catch(() => {
        toast(t('history.operationFailed'), 'error')
      })

      correctedText.value = result
      correctionIsActual.value = true
    } catch {
      correctedText.value = writerInputStore.value
    } finally {
      menuModalsStore.clearPendingModal()
    }
  }

  // TODO: текст могут отредактировать в diff ???
  menuModalsStore.nextModal(MenuModals.INSERT, {
    text: correctedText.value,
    oldText: writerInputStore.value,
  })
}
</script>

<style scoped>
.write-mode-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  flex: 1;
  min-height: 0;
}

.write-frame {
  display: flex;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  overflow: hidden;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.write-frame:focus-within {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  box-shadow:
    var(--app-shadow-sm),
    0 0 0 3px color-mix(in oklab, var(--color-primary) 12%, transparent);
}

.write-frame :deep(.main-input) {
  padding: var(--editor-padding);
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
}

.write-rail {
  display: flex;
  flex-direction: column;
  padding: 0.375rem;
  border-left: 1px solid var(--app-border-subtle);
}

.write-rail :deep(.btn-ghost) {
  color: var(--app-text-muted);
}

.write-rail :deep(.btn-ghost:hover) {
  color: var(--color-error);
}

.write-hint {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
  font-size: 0.75rem;
  color: var(--app-text-muted);
}
</style>
