<template>
  <div>
    <SettingsSection :title="t('settings.sectionAppearance')">
      <FieldRow group :label="t('settings.theme')">
        <SegmentedControl
          v-model="userConfig.appearance.theme"
          :label="t('settings.theme')"
          :options="themeOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.userLanguage')">
        <FieldSelect
          v-model="userConfig.userLanguage"
          :options="userLanguageOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.appLanguage')">
        <div class="flex items-center gap-2 w-full">
          <FieldSelect
            v-if="isAppLanguageManual"
            class="flex-1"
            :model-value="effectiveAppLanguage"
            :options="appLanguageOptions"
            @update:model-value="updateAppLanguage"
          />
          <span v-else class="flex-1 text-sm text-muted">
            {{ getLanguageName(effectiveAppLanguage) }}
          </span>
          <Button size="sm" variant="ghost" @click="toggleAppLanguageMode">
            {{
              isAppLanguageManual
                ? t('settings.appLanguageAuto')
                : t('settings.appLanguageManual')
            }}
          </Button>
        </div>
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
            :options="
              windowInsertionTabs.map((tab) => ({
                id: tab.key,
                name: tab.text,
              }))
            "
            :model-value="userConfig.windowInsertion.method"
            @update:model-value="updateWindowInsertionMethod"
          />
          <FieldInput
            v-if="userConfig.windowInsertion.method === 'xdotool'"
            v-model="userConfig.windowInsertion.xdotoolBin"
          />
          <FieldInput
            v-if="userConfig.windowInsertion.method === 'ydotool'"
            v-model="userConfig.windowInsertion.ydotoolBin"
          />
        </div>
      </FieldRow>
      <FieldRow
        :label="t('settings.pasteShortcut')"
        :info="t('settings.pasteShortcutHint')"
      >
        <FieldSelect
          v-model="userConfig.windowInsertion.pasteShortcut"
          :options="pasteShortcutOptions"
        />
      </FieldRow>
    </SettingsSection>

    <StorageLocations />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  AUTO_LANGUAGE_VALUE,
  SUPPORTED_UI_LANGUAGE_OPTIONS,
  buildLanguageOptions,
  getNavigatorLanguages,
  resolveUiLanguagePreference,
} from '../../lib/locale/language'
import StorageLocations from './StorageLocations.vue'
import type { UserConfig } from '@tyco/shared'
import type { ThemeMode } from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()
const userConfig = computed(() => props.userConfig)
const { t } = useI18n()
const effectiveAppLanguage = computed(() =>
  resolveUiLanguagePreference(
    userConfig.value.appLanguage,
    userConfig.value.userLanguage,
    getNavigatorLanguages()
  )
)
const themeOptions = computed<{ id: ThemeMode; name: string; icon: string }[]>(
  () => [
    { id: 'auto', name: t('theme.auto'), icon: 'mdi:theme-light-dark' },
    { id: 'light', name: t('theme.light'), icon: 'mdi:white-balance-sunny' },
    { id: 'dark', name: t('theme.dark'), icon: 'mdi:weather-night' },
    { id: 'e-ink', name: t('theme.eInk'), icon: 'mdi:book-open-page-variant' },
  ]
)

const windowInsertionTabs = computed(() => [
  { text: 'xdotool', key: 'xdotool' },
  { text: 'ydotool', key: 'ydotool' },
])

const isAppLanguageManual = computed(
  () => userConfig.value.appLanguage !== AUTO_LANGUAGE_VALUE
)

const pasteShortcutOptions = computed(() => {
  return [
    { id: 'ctrl+v', name: `Ctrl+V — ${t('settings.pasteShortcutRegular')}` },
    {
      id: 'ctrl+shift+v',
      name: `Ctrl+Shift+V — ${t('settings.pasteShortcutTerminals')}`,
    },
    {
      id: 'shift+insert',
      name: `Shift+Insert — ${t('settings.pasteShortcutAnyLayout')}`,
    },
  ]
})

const appLanguageOptions = computed(() => {
  return buildLanguageOptions(
    [effectiveAppLanguage.value, userConfig.value.appLanguage],
    false,
    t,
    SUPPORTED_UI_LANGUAGE_OPTIONS
  )
})

const userLanguageOptions = computed(() => {
  return buildLanguageOptions([userConfig.value.userLanguage], true, t)
})

const getLanguageName = (language: string) =>
  appLanguageOptions.value.find((option) => option.id === language)?.name ||
  language

const updateWindowInsertionMethod = (value: string | number) => {
  if (value !== 'xdotool' && value !== 'ydotool') {
    return
  }

  userConfig.value.windowInsertion.method = value
}

const updateAppLanguage = (value: number | string | undefined) => {
  if (typeof value !== 'string') {
    return
  }

  userConfig.value.appLanguage = value
}

const toggleAppLanguageMode = () => {
  if (isAppLanguageManual.value) {
    userConfig.value.appLanguage = AUTO_LANGUAGE_VALUE
    return
  }

  userConfig.value.appLanguage = effectiveAppLanguage.value
}
</script>
