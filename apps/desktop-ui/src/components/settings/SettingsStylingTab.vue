<template>
  <RuleLibrarySettings
    task="rewrite"
    title-key="settings.stylingTab"
    hint-key="settings.stylingHint"
    library-key="styling"
    id-prefix="style"
    :is-main-action-of="
      (action, id) => action.type === 'styling' && action.stylingId === id
    "
  />
</template>

<script setup lang="ts">
import RuleLibrarySettings from './RuleLibrarySettings.vue'
</script>
