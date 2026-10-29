<template>
  <ContentPadding>
    <StylingMenu :text="text" :shortcuts-disabled="shortcutsDisabled" />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import StylingMenu from '../components/menu/StylingMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'

const { text, shortcutsDisabled } = useSelectionActionContext()
</script>
