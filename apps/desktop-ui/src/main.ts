import { DESKTOP_WINDOW_LABELS } from '@tyco/shared'
import { createApp } from 'vue'
import { disposePinia } from 'pinia'

import App from './App.vue'
import QuietExecutor from './QuietExecutor.vue'
import { getDesktopWindowLabel } from './lib/desktop/window'
import './assets/main.css'
import { i18n } from './lib/i18n'
import { registerOfflineIcons } from './lib/icons'
import { clientLogger } from './lib/logger'
import router from './router'
import pinia from './stores'

registerOfflineIcons()

const isQuietExecutor = getDesktopWindowLabel() === DESKTOP_WINDOW_LABELS.QUIET
const app = createApp(isQuietExecutor ? QuietExecutor : App)
clientLogger.setupGlobalHandlers(app)

if (!isQuietExecutor) app.use(router)
app.use(pinia)
app.use(i18n)

app.onUnmount(() => disposePinia(pinia))
app.mount('#app')
