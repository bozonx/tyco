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
        <KeyButton>{{ submitShortcutLabel }}</KeyButton>
        <span>{{ t('write.next') }}</span>
        <span class="opacity-40">•</span>
        <KeyButton>Tab</KeyButton>
        <span>{{ t('shortcuts.insertIntoEditor') }}</span>
        <span class="opacity-40">•</span>
        <KeyButton>Esc</KeyButton>
        <span>{{ t('write.cancel') }}</span>
      </p>
    </div>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useCallAi } from '../composables/useCallAi'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { resolveQuickInputKeyAction } from '../lib/quick-input/quick-input-keys'
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
const ipcStore = useIpcStore()
const { correctText } = useCallAi()
const menuModalsStore = useMenuModalsStore()
const historyStore = useHistoryStore()
const { toast } = useToast()
const appConfig = ipcStore.params!.appConfig
const correctedText = ref('')
const correctionIsActual = ref(true)
const { t } = useI18n()

const submitMode = computed(
  () => ipcStore.params?.userConfig?.quickInputSubmit || 'enter'
)
const submitShortcutLabel = computed(() =>
  submitMode.value === 'ctrlEnter' ? 'Ctrl+Enter' : 'Enter'
)

function resetNav() {
  navPanelStore.resetNavParams({ panelVisible: false })
}

resetNav()

watch(
  () => ipcStore.params?.activationId,
  () => {
    const { isWindowShown, mode } = ipcStore.params
    if (isWindowShown && mode === 'write') {
      menuModalsStore.closeAll()
      writerInputStore.clear()
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

function cancelAndClose() {
  writerInputStore.clear()
  menuModalsStore.closeAll()
  resetNav()
  void ipcStore.callFunction('closeWindow', [])
}

function handleKeyDown(event: KeyboardEvent) {
  if (
    !ipcStore.params.isWindowShown ||
    ipcStore.params.mode !== 'write' ||
    menuModalsStore.anyModalOpen
  ) {
    return
  }

  const action = resolveQuickInputKeyAction(event, submitMode.value)
  if (action === 'cancel') {
    event.preventDefault()
    cancelAndClose()
    return
  }

  if (action === 'submit') {
    event.preventDefault()
    void doCorrection()
    return
  }

  if (action === 'to-editor') {
    event.preventDefault()
    routeParamsStore.toEditor(writerInputStore.value)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

const clear = () => {
  writerInputStore.clear()
  writerInputStore.focus()
}

async function doCorrection() {
  if (!writerInputStore.value?.trim()) {
    correctedText.value = ''
    correctionIsActual.value = true
    menuModalsStore.nextModal(MenuModals.INSERT, { text: '', oldText: '' })
    return
  } else if (correctionIsActual.value) {
    // Proceed directly with existing correction
  } else if (writerInputStore.value.length < appConfig.minCorrectionLength) {
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
  justify-content: flex-end;
  gap: var(--space-sm);
  flex: 1;
  min-height: 0;
}

.write-frame {
  display: flex;
  min-height: 3rem;
  max-height: 400px;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: color-mix(in oklab, var(--app-surface) 96%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--app-shadow-md);
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
