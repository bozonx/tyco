<template>
  <SettingsSection
    :title="t('settings.appHotkeysTitle')"
    :description="t('settings.appHotkeysHint')"
  >
    <FieldRow
      v-for="action in actions"
      :key="action"
      :label="t(`settings.quickInputActions.${action}`)"
    >
      <div class="flex flex-wrap items-center gap-2 w-full">
        <input
          class="input flex-1 min-w-32"
          :value="hotkeys[action]"
          :placeholder="t('settings.hotkeyUnassigned')"
          :aria-label="t(`settings.quickInputActions.${action}`)"
          readonly
          @keydown.stop.prevent="record($event, action)"
        />
        <Button
          sm
          neutral
          :disabled="hotkeys[action] === defaults[action]"
          @click="setShortcut(action, defaults[action])"
        >
          {{ t('settings.resetToDefault') }}
        </Button>
        <Button
          v-if="action === 'insertWithoutCorrection' && hotkeys[action]"
          sm
          neutral
          @click="setShortcut(action, '')"
        >
          {{ t('settings.clearShortcut') }}
        </Button>
      </div>
    </FieldRow>
    <p v-if="error" role="alert" class="text-error">{{ error }}</p>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  quickInputShortcut,
  resolveQuickInputHotkeys,
} from '../../lib/quick-input/quick-input-keys'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import SettingsSection from '../common/SettingsSection.vue'
import {
  DEFAULT_QUICK_INPUT_HOTKEYS,
  type QuickInputAction,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()
const { t } = useI18n()
const defaults = DEFAULT_QUICK_INPUT_HOTKEYS
const actions = Object.keys(defaults) as QuickInputAction[]
const hotkeys = computed(() =>
  resolveQuickInputHotkeys(props.userConfig.quickInputHotkeys)
)
const error = ref('')

function setShortcut(action: QuickInputAction, shortcut: string) {
  const conflict = actions.find(
    (other) => other !== action && shortcut && hotkeys.value[other] === shortcut
  )
  if (conflict) {
    error.value = t('settings.appHotkeyConflict', {
      action: t(`settings.quickInputActions.${conflict}`),
    })
    return
  }
  error.value = ''
  props.userConfig.quickInputHotkeys = { ...hotkeys.value, [action]: shortcut }
}

function record(event: KeyboardEvent, action: QuickInputAction) {
  const shortcut = quickInputShortcut(event)
  if (shortcut) setShortcut(action, shortcut)
}
</script>
