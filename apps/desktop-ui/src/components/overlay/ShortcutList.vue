<template>
  <div class="shortcuts-list">
    <!-- 5 columns x 3 rows grid for physical keyboard layout: qwert / asdfg / zxcvb -->
    <div v-if="hasPresetActions" class="shortcuts-grid-5x3">
      <template v-for="slot in slots" :key="slot.key">
        <ShortcutButton
          v-if="slot.action"
          size="sm"
          tile
          :icon="slot.action.icon"
          :content-key="
            pageIndex === undefined
              ? undefined
              : `${slot.action.id}:${slot.label}:${slot.action.icon}`
          "
          :motion-direction="motionDirection"
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
    <!-- Primary / System actions row: Space/Enter, Tab, Esc -->
    <div
      v-if="props.spaceKey || props.isEditorButtonVisible"
      class="shortcuts-primary"
    >
      <ShortcutButton
        v-if="props.isEditorButtonVisible"
        :keys="[]"
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'

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
    pageIndex?: number
    motionDirection?: number
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
    pageIndex: undefined,
    motionDirection: 1,
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
const { handleEsc } = useOverlayNav(() => ({
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

watch(
  () => props.pageIndex,
  () => pressedKeys.clear(),
  { flush: 'sync' }
)

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
  return event.code !== 'Escape' && isTextEntryTarget(event.target)
}

/** Whether Space/Enter on this target activates a focused clickable element */
function isClickableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest('button, a, [role=button]'))
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
    (event.code === 'Space' || event.code === 'Enter') &&
    isClickableTarget(event.target)
  ) {
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
  if (
    (event.code === 'Space' || event.code === 'Enter') &&
    isClickableTarget(event.target)
  )
    return
  if (textAtKeyDown !== props.text) return
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return

  if (
    (event.code === 'Space' || event.code === 'Enter') &&
    props.spaceKey &&
    !props.spaceKey.disabled
  ) {
    void props.spaceKey.action(props.text || '')
  } else if (event.code === 'Escape' && props.escVisible) {
    event.preventDefault()
    handleEsc()
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
  gap: var(--quick-section-gap);
  width: 100%;
}

/* Footer: the main action sits last, at the right, like a dialog's confirm */
.shortcuts-primary {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-sm);
  padding-top: var(--quick-section-gap);
  border-top: 1px solid var(--quick-divider);

  --shortcut-width: auto;
}

/* 5 x 3 tiles mirror the physical keys: an empty slot keeps its place */
.shortcuts-grid-5x3 {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-auto-rows: var(--quick-tile-height);
  gap: var(--quick-tile-gap);
}

.shortcut-empty-slot {
  border: 1px dashed var(--quick-tile-empty-border);
  border-radius: var(--quick-tile-radius);
  opacity: 0.6;
}
</style>
