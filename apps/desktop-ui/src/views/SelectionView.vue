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

const { text, shortcutsDisabled } = useSelectionActionContext()
</script>
