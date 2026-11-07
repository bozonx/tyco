<template>
  <ContentPadding>
    <ChatPromptsMenu
      :text="text"
      :shortcuts-disabled="shortcutsDisabled"
      :page-index="desktopStore.desktopState.actionPageIndex ?? 0"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import ChatPromptsMenu from '../components/menu/ChatPromptsMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'
import { useDesktopStore } from '../stores/desktop'

const { text, shortcutsDisabled } = useSelectionActionContext()
const desktopStore = useDesktopStore()
</script>
