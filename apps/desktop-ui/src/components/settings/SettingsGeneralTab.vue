<template>
  <div class="settings-stack">
    <SettingsSection :title="t('settings.sectionAppearance')">
      <FieldRow group :label="t('settings.theme')">
        <SegmentedControl
          v-model="userConfig.appearance.theme"
          :label="t('settings.theme')"
          :options="themeOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.appLanguage')">
        <FieldSelect
          :model-value="userConfig.language.ui"
          :options="appLanguageOptions"
          @update:model-value="updateAppLanguage"
        />
      </FieldRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.sectionWindowInsertion')">
      <FieldRow
        group
        :label="t('settings.windowInsertion')"
        :info="t('settings.windowInsertionHint')"
      >
        <div class="flex flex-col gap-2 w-full">
          <SegmentedControl
            :label="t('settings.windowInsertion')"
            :options="windowInsertionOptions"
            :model-value="userConfig.windowInsertion.linux.method"
            @update:model-value="updateWindowInsertionMethod"
          />
          <FieldInput
            v-if="userConfig.windowInsertion.linux.method !== 'ydotool'"
            v-model="userConfig.windowInsertion.linux.xdotoolPath"
            :placeholder="t('settings.binaryPathPlaceholder')"
          />
          <FieldInput
            v-if="userConfig.windowInsertion.linux.method !== 'xdotool'"
            v-model="userConfig.windowInsertion.linux.ydotoolPath"
            :placeholder="t('settings.binaryPathPlaceholder')"
          />
        </div>
      </FieldRow>
      <FieldRow
        :label="t('settings.pasteShortcut')"
        :info="t('settings.pasteShortcutHint')"
      >
        <FieldSelect
          v-model="userConfig.windowInsertion.linux.pasteShortcut"
          :options="pasteShortcutOptions"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.terminalPasteShortcut')"
        :info="t('settings.terminalPasteShortcutHint')"
      >
        <FieldSelect
          :model-value="
            userConfig.windowInsertion.linux.terminalPasteShortcut ?? 'same'
          "
          :options="terminalPasteShortcutOptions"
          @update:model-value="updateTerminalPasteShortcut"
        />
      </FieldRow>
    </SettingsSection>

    <StorageLocations :is-in-development="userConfig.isInDevelopment" />
    <div class="development-features-row">
      <FieldCheckbox
        v-if="userConfig.isInDevelopment"
        :model-value="true"
        label="In development features"
        @update:model-value="delete userConfig.isInDevelopment"
      />
      <button
        v-else
        type="button"
        class="development-features-trigger"
        aria-label="In development features"
        @click="userConfig.isInDevelopment = true"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  AUTO_LANGUAGE_VALUE,
  SUPPORTED_UI_LANGUAGE_OPTIONS,
  buildLanguageOptions,
} from '../../lib/locale/language'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsSection from './SettingsSection.vue'
import StorageLocations from './StorageLocations.vue'
import {
  LINUX_INSERTION_METHODS,
  type LinuxInsertionMethod,
  type PasteShortcut,
  type ThemeMode,
} from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()
const themeOptions = computed<{ id: ThemeMode; name: string; icon: string }[]>(
  () => [
    { id: 'auto', name: t('theme.auto'), icon: 'mdi:theme-light-dark' },
    { id: 'light', name: t('theme.light'), icon: 'mdi:white-balance-sunny' },
    { id: 'dark', name: t('theme.dark'), icon: 'mdi:weather-night' },
    { id: 'eInk', name: t('theme.eInk'), icon: 'mdi:book-open-page-variant' },
  ]
)

const windowInsertionOptions = computed(() => [
  { id: 'auto', name: t('settings.windowInsertionAuto') },
  { id: 'xdotool', name: 'xdotool' },
  { id: 'ydotool', name: 'ydotool' },
])

const pasteShortcutOptions = computed(() => {
  return [
    { id: 'Ctrl+V', name: `Ctrl+V — ${t('settings.pasteShortcutRegular')}` },
    {
      id: 'Ctrl+Shift+V',
      name: `Ctrl+Shift+V — ${t('settings.pasteShortcutTerminals')}`,
    },
    {
      id: 'Shift+Insert',
      name: `Shift+Insert — ${t('settings.pasteShortcutAnyLayout')}`,
    },
  ]
})

const terminalPasteShortcutOptions = computed(() => [
  { id: 'same', name: t('settings.terminalPasteShortcutSame') },
  ...pasteShortcutOptions.value,
])

const updateTerminalPasteShortcut = (value: string | number | undefined) => {
  if (value === undefined) return
  userConfig.value.windowInsertion.linux.terminalPasteShortcut =
    value === 'same' ? null : (value as PasteShortcut)
}

const appLanguageOptions = computed(() => {
  return [
    { id: AUTO_LANGUAGE_VALUE, name: t('settings.appLanguageSystem') },
    ...buildLanguageOptions(
      [userConfig.value.language.ui],
      false,
      t,
      SUPPORTED_UI_LANGUAGE_OPTIONS
    ),
  ]
})

const updateWindowInsertionMethod = (value: string | number) => {
  if (!LINUX_INSERTION_METHODS.includes(value as LinuxInsertionMethod)) return
  userConfig.value.windowInsertion.linux.method = value as LinuxInsertionMethod
}

const updateAppLanguage = (value: number | string | undefined) => {
  if (typeof value !== 'string') {
    return
  }

  userConfig.value.language.ui = value
}
</script>

<style scoped>
.development-features-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: calc(2.25rem + 2 * var(--space-md));
}
.development-features-trigger {
  width: calc(2.25rem + 2 * var(--space-md));
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  background: transparent;
}
.development-features-trigger:focus-visible {
  box-shadow: var(--app-focus-ring);
}
</style>
