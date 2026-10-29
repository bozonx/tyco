<template>
  <ContentPadding>
    <TransformationMenu :text="text" :shortcuts-disabled="shortcutsDisabled" />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import TransformationMenu from '../components/menu/TransformationMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'

const { text, shortcutsDisabled } = useSelectionActionContext()
</script>
