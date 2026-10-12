/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >
  export default component
}

declare module 'virtual:offline-icons' {
  import type { IconifyJSON } from '@iconify/types'

  const collection: IconifyJSON
  export default collection
}
