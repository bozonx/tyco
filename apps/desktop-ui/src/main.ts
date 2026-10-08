import { createApp } from 'vue'

import App from './App.vue'
import './assets/main.css'
import { i18n } from './lib/i18n'
import { registerOfflineIcons } from './lib/icons'
import { clientLogger } from './lib/logger'
import router from './router'
import pinia from './stores'

registerOfflineIcons()

const app = createApp(App)
clientLogger.setupGlobalHandlers(app)

app.use(router)
app.use(pinia)
app.use(i18n)

app.mount('#app')
