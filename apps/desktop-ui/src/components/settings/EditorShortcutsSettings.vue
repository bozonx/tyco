<template>
  <SettingsSection
    :title="t('settings.editorShortcuts.title')"
    :info="t('settings.editorShortcuts.hint')"
  >
    <FieldRow
      v-for="id in EDITOR_SHORTCUT_IDS"
      :key="id"
      :label="t(editorShortcutLabel(id))"
      :error="errors[id]"
    >
      <div class="shortcut-control">
        <HotkeyInput
          :model-value="draft.editor.shortcuts[id]"
          :aria-label="t(editorShortcutLabel(id))"
          :placeholder="t('settings.hotkeyNotAssigned')"
          :platform="hotkeys.providerState.platform"
          editor
          @update:model-value="setShortcut(id, $event)"
          @recording="hotkeys.suspendHotkeys"
        />
        <IconButton
          v-if="draft.editor.shortcuts[id]"
          size="sm"
          variant="ghost"
          icon="mdi:close"
          :label="t('settings.unassignHotkey')"
          @click="setShortcut(id, '')"
        />
        <IconButton
          v-if="
            draft.editor.shortcuts[id] !==
            DEFAULT_USER_CONFIG.editor.shortcuts[id]
          "
          size="sm"
          variant="ghost"
          icon="mdi:restore"
          :label="t('settings.resetToDefault')"
          @click="setShortcut(id, DEFAULT_USER_CONFIG.editor.shortcuts[id])"
        />
      </div>
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  EDITOR_SHORTCUT_IDS,
  RESERVED_EDITOR_SHORTCUTS,
  editorShortcutLabel,
} from '../../lib/editor/editor-shortcuts'
import { useGlobalHotkeysStore } from '../../stores/global-hotkeys'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import HotkeyInput from './HotkeyInput.vue'
import SettingsSection from './SettingsSection.vue'
import { DEFAULT_USER_CONFIG, type EditorShortcutId } from '@tyco/shared'

const { t } = useI18n()
const { draft } = useSettingsContext()
const hotkeys = useGlobalHotkeysStore()
const errors = ref<Partial<Record<EditorShortcutId, string>>>({})

function setShortcut(id: EditorShortcutId, shortcut: string) {
  const duplicate =
    shortcut &&
    EDITOR_SHORTCUT_IDS.find(
      (other) =>
        other !== id && draft.value.editor.shortcuts[other] === shortcut
    )
  if (duplicate) {
    errors.value[id] = t('settings.hotkeyStatus.duplicate', {
      action: t(editorShortcutLabel(duplicate)),
    })
    return
  }
  const globalConflict =
    shortcut &&
    (Object.values(draft.value.hotkeys).includes(shortcut) ||
      Object.values(hotkeys.providerState.systemTriggers).some((value) =>
        value?.split(', ').includes(shortcut)
      ))
  if (RESERVED_EDITOR_SHORTCUTS.has(shortcut) || globalConflict) {
    errors.value[id] = t('settings.editorShortcuts.reserved')
    return
  }
  delete errors.value[id]
  draft.value.editor.shortcuts[id] = shortcut
}
</script>

<style scoped>
.shortcut-control {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}
</style>
