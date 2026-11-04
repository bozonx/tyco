<template>
  <ContentPadding>
    <FavoritesMenu :shortcuts-disabled="shortcutsDisabled" />
  </ContentPadding>
</template>

<script setup lang="ts">
import ContentPadding from '../components/common/ContentPadding.vue'
import FavoritesMenu from '../components/menu/FavoritesMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'

const { shortcutsDisabled } = useSelectionActionContext()
</script>
