<template>
  <ContentPadding>
    <QuickAiRequestMenu
      :text="text"
      :shortcuts-disabled="shortcutsDisabled"
      :input-mode="props.inputMode"
      :profile-id="props.profileId"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import QuickAiRequestMenu from '../components/menu/QuickAiRequestMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'

const props = withDefaults(
  defineProps<{
    inputMode?: 'text' | 'voice'
    profileId?: string | null
  }>(),
  {
    inputMode: 'text',
    profileId: null,
  }
)

const { text, shortcutsDisabled } = useSelectionActionContext()
</script>
