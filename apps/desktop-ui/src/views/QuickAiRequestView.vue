<template>
  <ContentPadding>
    <QuickAiRequestMenu
      :text="props.screenshotMode ? '' : text"
      :screenshot-mode="props.screenshotMode"
      :screenshots="
        props.screenshotMode ? desktopStore.desktopState.screenshots : undefined
      "
      :shortcuts-disabled="shortcutsDisabled"
      :input-mode="props.inputMode"
      :profile-id="effectiveProfileId"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import QuickAiRequestMenu from '../components/menu/QuickAiRequestMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'

const props = withDefaults(
  defineProps<{
    inputMode?: 'text' | 'voice'
    profileId?: string | null
    screenshotMode?: boolean
  }>(),
  { inputMode: 'text', profileId: null }
)

const desktopStore = useDesktopStore()
const actionMenuStore = useActionMenuStore()
const effectiveProfileId =
  props.profileId ?? actionMenuStore.consumePendingProfileId?.() ?? null
const { text, shortcutsDisabled } = useSelectionActionContext()
</script>
