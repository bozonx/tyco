import { createPinia } from 'pinia'
import { createApp } from 'vue'

import './assets/main.css'
import UiCatalog from './dev/UiCatalog.vue'
import { i18n } from './lib/i18n'
import { registerOfflineIcons } from './lib/icons'
import { installButtonMouseFocusPolicy } from './lib/ui/focus'

registerOfflineIcons()

// This development entry is deliberately excluded from the production build.
if (import.meta.env.DEV || import.meta.env.MODE === 'browser-test') {
  installButtonMouseFocusPolicy()
  createApp(UiCatalog).use(createPinia()).use(i18n).mount('#app')
}
