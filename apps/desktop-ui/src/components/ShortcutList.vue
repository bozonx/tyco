<template>
  <div class="shortcuts-list">
    <!-- Primary / System actions row: Space/Enter, Tab, Esc -->
    <div
      v-if="props.spaceKey || props.toEditorVisible || props.escVisible"
      class="shortcuts-primary"
    >
      <ShortcutButton
        v-if="props.spaceKey"
        :keys="['Space']"
        :icon="props.spaceKey.icon"
        :disabled="props.spaceKey.disabled"
        primary
        @click="props.spaceKey.action(props.text || '')"
      >
        {{ getActionLabel(props.spaceKey) }}
      </ShortcutButton>

      <ShortcutButton
        v-if="altVisible"
        :keys="['Shift', 'Space']"
        icon="mdi:undo-variant"
        :disabled="props.spaceKey?.disabled"
        @click="props.spaceKey?.action(props.altText || '')"
      >
        {{ t('write.insertOriginal') }}
      </ShortcutButton>

      <ShortcutButton
        v-if="props.toEditorVisible"
        :keys="['Tab']"
        icon="mdi:pencil-outline"
        @click="goToEditor"
      >
        {{ t('shortcuts.insertIntoEditor') }}
      </ShortcutButton>

      <ShortcutButton
        v-if="props.escVisible"
        :keys="['Esc']"
        icon="mdi:close"
        @click="handleEsc"
      >
        {{ t('common.close') }}
      </ShortcutButton>
    </div>

    <!-- 5 columns x 3 rows grid for physical keyboard layout: qwert / asdfg / zxcvb -->
    <div v-if="hasPresetActions" class="shortcuts-grid-5x3">
      <template v-for="slot in slots" :key="slot.key">
        <ShortcutButton
          v-if="slot.action"
          sm
          :keys="[slot.key.toUpperCase()]"
          :icon="slot.action.icon"
          :disabled="slot.action.disabled"
          @click="slot.action.action(props.text || '')"
        >
          {{ slot.label }}
        </ShortcutButton>
        <div v-else class="shortcut-empty-slot" aria-hidden="true" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import { useI18n } from '../composables/useI18n'
import { appNavigation } from '../lib/navigation/navigation'
import { type ActionItem } from '../stores/actionMenu'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useRouteParams } from '../stores/routeParams'
import { PRESETS_KEYS } from '../types'
import ShortcutButton from './common/ShortcutButton.vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

interface ShortcutSlotItem {
  key: string
  action?: ActionItem
  label?: string
}

const props = withDefaults(
  defineProps<{
    text?: string
    /** What `text` was transformed from, see `routeParams.toEditor`. */
    sourceText?: string
    spaceKey?: ActionItem
    /** Another version of the text, run through Shift+Space: the original */
    altText?: string
    toEditorVisible?: boolean
    escVisible?: boolean
    escAction?: () => void
    leftLetterKeys?: (ActionItem | undefined)[]
    stopListening?: boolean
  }>(),
  {
    text: '',
    sourceText: '',
    spaceKey: undefined,
    altText: undefined,
    toEditorVisible: false,
    escVisible: true,
    escAction: undefined,
    leftLetterKeys: () => [],
    stopListening: false,
  }
)

const routeParamsStore = useRouteParams()
const menuModalsStore = useMenuModalsStore()
const ipcStore = useIpcStore()
const { t } = useI18n()

/**
 * Exactly 15 slots mapping 1:1 to physical keys: Row 1 (0..4): Q W E R T Row 2
 * (5..9): A S D F G Row 3 (10..14): Z X C V B
 */
const slots = computed<ShortcutSlotItem[]>(() =>
  PRESETS_KEYS.map((key, index) => {
    const action = props.leftLetterKeys[index]
    const label = action ? getActionLabel(action) : ''
    return {
      key,
      action: label ? action : undefined,
      label: label || undefined,
    }
  })
)

const altVisible = computed(
  () =>
    Boolean(props.spaceKey) &&
    props.altText !== undefined &&
    props.altText !== props.text
)

/**
 * Text on screen when each key went down. A key acts on its release, and only
 * if it went down here and the text did not change meanwhile: the key that
 * opened this list, or a correction arriving mid-press, must not run an action
 * on a text the user has not seen
 */
const pressedKeys = new Map<string, string>()

const handleWindowBlur = () => {
  pressedKeys.clear()
}

const hasPresetActions = computed(() =>
  slots.value.some((slot) => Boolean(slot.action))
)

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleShortCutKeyUp)
  window.addEventListener('blur', handleWindowBlur)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleShortCutKeyUp)
  window.removeEventListener('blur', handleWindowBlur)
})

function handleKeyDown(event: KeyboardEvent) {
  if (props.stopListening) return
  if (!event.repeat) pressedKeys.set(event.code, props.text)

  // Prevent browser default tab focus movement and space scroll
  if (event.code === 'Tab' && props.toEditorVisible) {
    event.preventDefault()
  } else if (
    (event.code === 'Space' || event.code === 'Enter') &&
    props.spaceKey &&
    !props.spaceKey.disabled
  ) {
    event.preventDefault()
  }
}

function handleShortCutKeyUp(event: KeyboardEvent) {
  const textAtKeyDown = pressedKeys.get(event.code)
  pressedKeys.delete(event.code)
  if (props.stopListening || textAtKeyDown === undefined) return
  if (textAtKeyDown !== props.text) return

  if (
    (event.code === 'Space' || event.code === 'Enter') &&
    event.shiftKey &&
    altVisible.value
  ) {
    if (!props.spaceKey?.disabled) {
      props.spaceKey?.action(props.altText || '')
    }
  } else if (
    (event.code === 'Space' || event.code === 'Enter') &&
    props.spaceKey &&
    !props.spaceKey.disabled
  ) {
    props.spaceKey.action(props.text || '')
  } else if (event.code === 'Tab' && props.toEditorVisible) {
    goToEditor()
  } else if (event.code === 'Escape' && props.escVisible) {
    handleEsc()
  } else {
    let codeLetter: string | undefined
    if (event.code.length === 4 && event.code.startsWith('Key')) {
      codeLetter = event.code.slice(3).toLowerCase()
    }

    if (codeLetter && PRESETS_KEYS.includes(codeLetter)) {
      const index = PRESETS_KEYS.indexOf(codeLetter)
      const action = props.leftLetterKeys[index]
      if (action && !action.disabled) {
        action.action(props.text || '')
      }
    }
  }
}

function goToEditor() {
  routeParamsStore.toEditor(props.text, props.sourceText)
}

function handleEsc() {
  if (props.escAction) {
    props.escAction()
    return
  }

  if (menuModalsStore.currentModal !== MenuModals.NONE) {
    menuModalsStore.back()
  } else {
    try {
      if (getCurrentWindow().label === 'quick') {
        void ipcStore.callFunction('closeWindow', [])
      } else {
        void appNavigation.goToEditor()
      }
    } catch {
      // Dev mode fallback
    }
  }
}

function getActionLabel(item?: ActionItem) {
  if (!item) return ''
  return item.labelKey ? t(item.labelKey) : item.name || ''
}
</script>

<style scoped>
.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
}

.shortcuts-primary {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 2.25rem;
}

.shortcuts-grid-5x3 {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(3, 2.125rem);
  gap: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border-subtle);
}

.shortcut-empty-slot {
  min-height: 2.125rem;
  border-radius: var(--radius-md);
  border: 1px dashed transparent;
}
</style>
