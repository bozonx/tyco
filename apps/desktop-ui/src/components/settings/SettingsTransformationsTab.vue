<template>
  <RuleLibrarySettings
    task="transformation"
    hint-key="settings.transformationsHint"
    library-key="transformations"
    id-prefix="transformation"
    :is-main-action-of="
      (action, id) =>
        action.type === 'transformation' && action.transformationId === id
    "
  />
</template>

<script setup lang="ts">
import RuleLibrarySettings from './RuleLibrarySettings.vue'
</script>
