<template>
  <kbd class="kbd">
    <slot></slot>
  </kbd>
</template>

<style scoped>
.kbd {
  min-width: var(--key-size, 1.5rem);
  height: var(--key-size, 1.5rem);
  font-size: var(--key-font-size, var(--text-caption));
  border-color: var(--key-border-color, var(--app-border-strong));
  color: var(--key-color, var(--color-base-content));
  background-color: var(--key-background, var(--app-surface-raised));
}
</style>
