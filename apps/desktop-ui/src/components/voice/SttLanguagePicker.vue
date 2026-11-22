<template>
  <DropdownMenu
    v-if="isDeepgram"
    class="stt-language-picker"
    size="sm"
    icon="mdi:translate"
    :placement="placement"
    :align="align"
    :label="badgeLabel"
    :title="tooltipLabel"
    :disabled="isDisabled"
    :items="items"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  COMMON_LANGUAGE_OPTIONS,
  buildLanguageOptions,
  getLanguageLabelKey,
} from '../../lib/locale/language'
import {
  deepgramLanguageBadge,
  normalizeDeepgramLanguage,
  withDeepgramLanguage,
} from '../../lib/stt/deepgram-language'
import { DICTATION_LANGUAGE_AUTO } from '../../lib/stt/dictation-language'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'

const props = withDefaults(
  defineProps<{
    placement?: 'top' | 'bottom'
    align?: 'left' | 'right'
    disabled?: boolean
    /** The recording has text: a change starts over, or goes on from now */
    hasText?: boolean
    /**
     * Whose speech: `own` is the user's language of the STT settings,
     * `computer` the language of the computer sound, set only here
     */
    target?: 'own' | 'computer'
  }>(),
  {
    placement: 'top',
    align: 'left',
    disabled: false,
    hasText: false,
    target: 'own',
  }
)

const emit = defineEmits<{ (e: 'change', language: string): void }>()

const { t } = useI18n()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
const isSaving = ref(false)

const isDeepgram = computed(
  () => desktopStore.userConfig.stt?.provider === 'deepgram'
)

const currentLanguage = computed(() =>
  normalizeDeepgramLanguage(
    props.target === 'computer'
      ? desktopStore.userConfig.stt?.listenLanguage
      : desktopStore.userConfig.stt?.providers?.deepgram?.language
  )
)

const badgeLabel = computed(() =>
  deepgramLanguageBadge(currentLanguage.value, t('language.auto'))
)

const isDisabled = computed(() => props.disabled || isSaving.value)

const tooltipLabel = computed(() => {
  const name =
    currentLanguage.value === DICTATION_LANGUAGE_AUTO
      ? t('language.auto')
      : t(getLanguageLabelKey(currentLanguage.value))
  const label =
    props.target === 'computer'
      ? t('stt.computerLanguage')
      : t('settings.sttLanguage')
  return `${label}: ${name}`
})

async function selectLanguage(language: string) {
  const next = normalizeDeepgramLanguage(language)
  if (next === currentLanguage.value || isSaving.value) return
  isSaving.value = true
  try {
    const stt = desktopStore.savedUserConfig.stt
    const result = await desktopStore.updateUserConfig({
      stt:
        props.target === 'computer'
          ? { ...stt, listenLanguage: next }
          : withDeepgramLanguage(stt, next),
    })
    if (result.success) emit('change', next)
  } finally {
    isSaving.value = false
  }
}

function openSettings() {
  void ipcStore.callOrNotify('activate_mode', {
    mode: 'config',
    settingsTab: 'stt',
  })
}

const items = computed<DropdownMenuItem[]>(() => {
  const active = currentLanguage.value
  const allLanguages = buildLanguageOptions(
    [],
    false,
    t,
    COMMON_LANGUAGE_OPTIONS
  )
  // Keep the active non-auto language right under Auto for quick toggling.
  const activeOption =
    active !== DICTATION_LANGUAGE_AUTO
      ? (allLanguages.find((opt) => opt.id === active) ?? {
          id: active,
          name: active,
        })
      : undefined
  const rest = activeOption
    ? allLanguages.filter((opt) => opt.id !== active)
    : allLanguages

  const list: DropdownMenuItem[] = []
  // the change is told before it is made: the user may not expect it
  if (props.hasText)
    list.push({
      label:
        props.target === 'computer'
          ? t('stt.languageAppliesFromNow')
          : t('stt.languageRestartsRecording'),
      icon: 'mdi:information-outline',
      disabled: true,
      action: () => undefined,
    })
  list.push({
    label: t('language.auto'),
    icon: active === DICTATION_LANGUAGE_AUTO ? 'mdi:check' : undefined,
    action: () => selectLanguage(DICTATION_LANGUAGE_AUTO),
  })
  if (activeOption) {
    list.push({
      label: activeOption.name,
      icon: 'mdi:check',
      action: () => selectLanguage(activeOption.id),
    })
  }
  for (const option of rest) {
    list.push({ label: option.name, action: () => selectLanguage(option.id) })
  }
  list.push({
    label: t('stt.openSettings'),
    icon: 'mdi:cog-outline',
    action: openSettings,
  })
  return list
})
</script>
