<template>
  <ContentPadding>
    <AiTaskMenu :text="text" :shortcuts-disabled="shortcutsDisabled" />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import AiTaskMenu from '../components/menu/AiTaskMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'

const { text, shortcutsDisabled } = useSelectionActionContext()
</script>
