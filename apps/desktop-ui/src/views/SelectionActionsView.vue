<template>
  <ContentPadding>
    <InsertMenu
      :allowInsertButton="false"
      :text="text"
      :shortcutsDisabled="shortcutsDisabled"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { useSelectionActionContext } from '../composables/use-selection-action-context'
import { useNavPanelStore } from '../stores/nav-panel'

const navPanelStore = useNavPanelStore()
const { text, shortcutsDisabled } = useSelectionActionContext()

navPanelStore.resetNavPanelState({})
</script>
