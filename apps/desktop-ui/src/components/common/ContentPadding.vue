<template>
  <div class="content-padding">
    <slot></slot>
  </div>
</template>

<style scoped>
  .content-padding {
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: var(--space-xl);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
