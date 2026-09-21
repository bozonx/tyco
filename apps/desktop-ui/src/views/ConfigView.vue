<template>
  <Settings />
</template>

<script setup lang="ts">
import { useNavPanelStore } from '../stores/navPanel'

const navPanelStore = useNavPanelStore()

navPanelStore.resetNavParams({})
</script>
