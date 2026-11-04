<template>
  <ContentPadding>
    <SnippetsMenu :shortcuts-disabled="shortcutsDisabled" />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import SnippetsMenu from '../components/menu/SnippetsMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'

const { shortcutsDisabled } = useSelectionActionContext()
</script>
