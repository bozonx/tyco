<template>
  <ContentPadding>
    <InsertMenu
      :allow-insert-button="false"
      :text="text"
      :shortcuts-disabled="shortcutsDisabled"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import InsertMenu from '../components/menu/InsertMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'

const { text, shortcutsDisabled } = useSelectionActionContext()
</script>
