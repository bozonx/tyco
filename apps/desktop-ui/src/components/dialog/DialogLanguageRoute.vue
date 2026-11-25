<template>
  <!-- one button reads the route of the languages; its panel sets them -->
  <div
    ref="containerRef"
    class="dialog-route"
    @focusout="onFocusout"
    @keydown.esc="onEscape"
  >
    <Button
      ref="triggerRef"
      class="dialog-route-trigger"
      size="sm"
      variant="ghost"
      icon="mdi:translate"
      :active="isOpen"
      :title="t('dialog.languages')"
      :aria-label="`${t('dialog.languages')}: ${routeLabel}`"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      :aria-controls="isOpen ? panelId : undefined"
      @click="toggle"
    >
      <span class="dialog-route-label">{{ routeLabel }}</span>
      <AppIcon
        v-if="isTranslationWithoutModel"
        class="dialog-route-warning"
        icon="mdi:alert-circle-outline"
        size="sm"
      />
      <AppIcon icon="mdi:chevron-down" size="md" class="dialog-route-chevron" />
    </Button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        :id="panelId"
        ref="panelRef"
        role="dialog"
        class="dialog-route-panel"
        :aria-label="t('dialog.languages')"
        :style="panelStyle"
        :data-theme="panelTheme"
        @focusout="onFocusout"
        @keydown.esc="onEscape"
      >
        <label v-if="isDeepgram" class="dialog-route-field">
          <span>{{ t('dialog.remoteLanguage') }}</span>
          <FieldSelect
            :model-value="dialog.config.remoteLanguage || 'auto'"
            size="sm"
            :options="remoteLanguageOptions"
            @update:model-value="
              (language) =>
                dialog.updateConfig({
                  remoteLanguage: String(language ?? 'auto'),
                })
            "
          />
        </label>
        <label class="dialog-route-field">
          <span>{{ t('dialog.translationLanguage') }}</span>
          <FieldSelect
            :model-value="dialog.config.translationTargetLanguage"
            size="sm"
            :options="targetLanguageOptions"
            @update:model-value="
              (language) =>
                dialog.updateConfig({
                  translationTargetLanguage: String(language ?? ''),
                })
            "
          />
        </label>
        <FieldCheckbox
          :disabled="!dialog.config.translationTargetLanguage"
          :model-value="dialog.config.isTranslationOnly"
          :label="t('dialog.showTranslationOnly')"
          @update:model-value="
            (value) => dialog.updateConfig({ isTranslationOnly: value })
          "
        />
        <template v-if="!isGeminiLive">
          <hr class="dialog-route-separator" />
          <label class="dialog-route-field is-secondary">
            <span>{{ t('dialog.ownLanguage') }}</span>
            <FieldSelect
              :model-value="dialog.config.ownLanguage || ''"
              size="sm"
              :options="ownLanguageOptions"
              @update:model-value="
                (language) =>
                  dialog.updateConfig({ ownLanguage: String(language ?? '') })
              "
            />
          </label>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import { useI18n } from '../../composables/use-i18n'
import { usePopover } from '../../composables/use-popover'
import {
  dialogLanguageOptions,
  dialogRouteLabel,
} from '../../lib/dialog/dialog-languages'
import { COMMON_LANGUAGE_OPTIONS } from '../../lib/locale/language'
import { normalizeDeepgramLanguage } from '../../lib/stt/deepgram-language'
import { DICTATION_LANGUAGE_AUTO } from '../../lib/stt/dictation-language'
import { activeSttModel } from '../../lib/stt/stt-config'
import { translationLanguageLabel } from '../../lib/translation/translation-languages'
import { useDesktopStore } from '../../stores/desktop'
import { useDialogStore } from '../../stores/dialog'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldSelect from '../common/FieldSelect.vue'

const dialog = useDialogStore()
const desktopStore = useDesktopStore()
const { t, locale } = useI18n()

const panelId = useId()
const {
  isOpen,
  containerRef,
  triggerRef,
  panelRef,
  toggle,
  onFocusout,
  onEscape,
} = usePopover()
const { style: panelStyle, theme: panelTheme } = useAnchoredPanel({
  isOpen: () => isOpen.value,
  anchor: () => containerRef.value?.querySelector('button') ?? null,
  panel: () => panelRef.value,
  placement: () => 'bottom',
  align: () => 'start',
})

// only Deepgram is told the language of the other side
const isDeepgram = computed(
  () => desktopStore.userConfig.stt?.provider === 'deepgram'
)
const isGeminiLive = computed(
  () => desktopStore.userConfig.stt?.provider === 'geminiLive'
)
const model = computed(() => dialog.translationModel)
const isTranslationWithoutModel = computed(
  () => Boolean(dialog.config.translationTargetLanguage) && !model.value
)

const labelOf = (id: string) =>
  translationLanguageLabel(id, String(locale.value))

/** Listed ids, the current one first kept when it is none of the common ones */
function languageList(current: string | undefined) {
  const ids: string[] = COMMON_LANGUAGE_OPTIONS.map((option) => option.id)
  if (current && !ids.includes(current)) ids.unshift(current)
  return ids.map((id) => ({ id, name: labelOf(id) }))
}

const remoteLanguageOptions = computed(() => {
  const current = dialog.config.remoteLanguage
  return [
    { id: 'auto', name: t('dialog.languageAuto') },
    ...languageList(current === 'auto' ? undefined : current),
  ]
})
const defaultLanguage = computed(() => {
  const stt = desktopStore.userConfig.stt
  const sttModel = activeSttModel(stt)
  const normalized = normalizeDeepgramLanguage(sttModel.language)
  return normalized === DICTATION_LANGUAGE_AUTO
    ? t('dialog.languageAuto')
    : labelOf(normalized)
})

const ownLanguageOptions = computed(() => [
  {
    id: '',
    name: t('dialog.ownLanguageDefault', { language: defaultLanguage.value }),
  },
  ...languageList(dialog.config.ownLanguage),
])
const targetLanguageOptions = computed(() =>
  dialogLanguageOptions({
    targetLanguages: desktopStore.userConfig.translation?.targetLanguages,
    current: dialog.config.translationTargetLanguage,
    offLabel: t('dialog.noTranslation'),
    labelOf,
  })
)

const currentOwnLanguageTag = computed(() => {
  const custom = dialog.config.ownLanguage?.trim()
  if (custom) return custom
  const stt = desktopStore.userConfig.stt
  const sttModel = activeSttModel(stt)
  const normalized = normalizeDeepgramLanguage(sttModel.language)
  return normalized === DICTATION_LANGUAGE_AUTO ? 'auto' : normalized
})

const routeLabel = computed(() =>
  dialogRouteLabel({
    translationTargetLanguage: dialog.config.translationTargetLanguage,
    remoteLanguage: isDeepgram.value
      ? (dialog.config.remoteLanguage ?? 'auto')
      : 'auto',
    ownLanguage: currentOwnLanguageTag.value,
    isGemini: isGeminiLive.value,
  })
)
</script>

<style scoped>
.dialog-route {
  display: inline-flex;
  min-width: 0;
  flex-shrink: 1;
}

.dialog-route-trigger {
  min-width: 0;
  max-width: 18rem;
  flex-shrink: 1;
}

.dialog-route-label {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-route-warning {
  color: var(--color-warning);
}

.dialog-route-chevron {
  flex-shrink: 0;
  opacity: 0.7;
}

.dialog-route-panel {
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 18rem;
  max-width: calc(100vw - 2 * var(--space-md));
  padding: var(--space-md);
  background-color: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-lg);
}

.dialog-route-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-control);
}

.dialog-route-field.is-secondary {
  color: var(--app-text-muted);
}

.dialog-route-separator {
  margin: 0;
  border: 0;
  border-top: 1px solid var(--app-border-subtle);
}
</style>
