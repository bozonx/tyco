<template>
  <div class="shortcuts-list">
    <!-- Primary / System actions row: Space/Enter, Tab, Esc -->
    <div
      v-if="props.spaceKey || props.isEditorButtonVisible"
      class="shortcuts-primary"
    >
      <ShortcutButton
        v-if="props.isEditorButtonVisible"
        :keys="props.editorShortcut ? ['Tab'] : []"
        :title="props.editorButtonLabel ?? t('shortcuts.insertIntoEditor')"
        @click="goToEditor"
      >
        {{ props.editorButtonLabel ?? t('shortcuts.insertIntoEditor') }}
      </ShortcutButton>

      <ShortcutButton
        v-if="props.spaceKey"
        :keys="['Space', 'Enter']"
        :disabled="props.spaceKey.disabled"
        :title="
          props.spaceKey.hint
            ? `${getActionLabel(props.spaceKey)} (${props.spaceKey.hint})`
            : getActionLabel(props.spaceKey)
        "
        variant="primary"
        @click="props.spaceKey.action(props.text || '')"
      >
        {{ getActionLabel(props.spaceKey) }}
      </ShortcutButton>
    </div>

    <!-- 5 columns x 3 rows grid for physical keyboard layout: qwert / asdfg / zxcvb -->
    <div v-if="hasPresetActions" class="shortcuts-grid-5x3">
      <template v-for="slot in slots" :key="slot.key">
        <ShortcutButton
          v-if="slot.action"
          size="sm"
          :keys="[slot.key.toUpperCase()]"
          :disabled="slot.action.disabled"
          :title="
            slot.action.hint
              ? `${slot.label} (${slot.action.hint})`
              : slot.label
          "
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

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import { isTextEntryTarget } from '../../lib/ui/text-entry-target'
import { type ActionItem } from '../../stores/action-menu'
import { SHORTCUT_SLOT_KEYS } from '../../types'
import ShortcutButton from './ShortcutButton.vue'

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
    isEditorButtonVisible?: boolean
    editorShortcut?: boolean
    editorButtonLabel?: string
    escVisible?: boolean
    escAction?: () => void
    escMode?: 'close' | 'back' | 'auto'
    leftLetterKeys?: (ActionItem | undefined)[]
    shortcutsDisabled?: boolean
  }>(),
  {
    text: '',
    sourceText: '',
    spaceKey: undefined,
    isEditorButtonVisible: false,
    editorShortcut: false,
    editorButtonLabel: undefined,
    escVisible: true,
    escAction: undefined,
    escMode: 'auto',
    leftLetterKeys: () => [],
    shortcutsDisabled: false,
  }
)

const editorNavigation = useEditorNavigation()
const { t } = useI18n()
const { handleEsc, handleCloseAll } = useOverlayNav(() => ({
  escMode: props.escMode,
  onEsc: props.escAction,
}))

/**
 * Exactly 15 slots mapping 1:1 to physical keys: Row 1 (0..4): Q W E R T Row 2
 * (5..9): A S D F G Row 3 (10..14): Z X C V B
 */
const slots = computed<ShortcutSlotItem[]>(() =>
  SHORTCUT_SLOT_KEYS.map((key, index) => {
    const action = props.leftLetterKeys[index]
    const label = action ? getActionLabel(action) : ''
    return {
      key,
      action: label ? action : undefined,
      label: label || undefined,
    }
  })
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
  window.addEventListener('keyup', handleShortcutKeyUp)
  window.addEventListener('blur', handleWindowBlur)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleShortcutKeyUp)
  window.removeEventListener('blur', handleWindowBlur)
})

/** Keys typed into a field belong to its text; only Escape stays a shortcut */
function isTypingKey(event: KeyboardEvent) {
  return (
    event.code !== 'Escape' &&
    (isTextEntryTarget(event.target) ||
      (event.target instanceof Element &&
        Boolean(event.target.closest('button, a, [role=button]'))))
  )
}

function handleKeyDown(event: KeyboardEvent) {
  if (props.shortcutsDisabled || event.defaultPrevented || event.isComposing)
    return
  if (isTypingKey(event)) {
    pressedKeys.delete(event.code)
    return
  }
  if (
    event.code === 'Tab' &&
    (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)
  ) {
    return
  }
  if (!event.repeat) pressedKeys.set(event.code, props.text)

  if (
    event.code === 'Tab' &&
    props.editorShortcut &&
    props.isEditorButtonVisible
  )
    event.preventDefault()

  // Prevent browser default tab focus movement and space scroll
  if (
    (event.code === 'Space' || event.code === 'Enter') &&
    props.spaceKey &&
    !props.spaceKey.disabled
  ) {
    event.preventDefault()
  }
}

function handleShortcutKeyUp(event: KeyboardEvent) {
  const textAtKeyDown = pressedKeys.get(event.code)
  pressedKeys.delete(event.code)
  if (props.shortcutsDisabled || textAtKeyDown === undefined) return
  if (isTypingKey(event)) return
  if (textAtKeyDown !== props.text) return
  if (
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    (event.shiftKey && event.code !== 'Escape')
  )
    return

  if (
    (event.code === 'Space' || event.code === 'Enter') &&
    props.spaceKey &&
    !props.spaceKey.disabled
  ) {
    void props.spaceKey.action(props.text || '')
  } else if (
    event.code === 'Tab' &&
    props.editorShortcut &&
    props.isEditorButtonVisible
  ) {
    goToEditor()
  } else if (event.code === 'Escape' && props.escVisible) {
    event.preventDefault()
    if (event.shiftKey) {
      handleCloseAll()
    } else {
      handleEsc()
    }
  } else {
    let codeLetter: string | undefined
    if (event.code.length === 4 && event.code.startsWith('Key')) {
      codeLetter = event.code.slice(3).toLowerCase()
    }

    const index = SHORTCUT_SLOT_KEYS.findIndex((key) => key === codeLetter)
    if (index >= 0) {
      const action = props.leftLetterKeys[index]
      if (action && !action.disabled) {
        void action.action(props.text || '')
      }
    }
  }
}

function goToEditor() {
  // Intentionally insert into the editor with replacement: replaces current editor content
  // directly without showing a diff comparison between existing text and new text.
  editorNavigation.toEditor(props.text)
}

function getActionLabel(item?: ActionItem) {
  if (!item) return ''
  return item.labelKey ? t(item.labelKey) : item.label || item.name || ''
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
  justify-content: flex-end;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 2.25rem;
}

.shortcuts-grid-5x3 {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(3, 2.75rem);
  gap: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border-subtle);
}

.shortcut-empty-slot {
  min-height: 2.75rem;
  border-radius: var(--radius-md);
  border: 1px dashed transparent;
}
</style>
