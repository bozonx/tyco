import miniToastr from 'mini-toastr'
import { createApp } from 'vue'

import App from './App.vue'
import './assets/main.css'
import { i18n } from './lib/i18n'
import router from './router'
import pinia from './stores'

const app = createApp(App)

app.use(router)
app.use(pinia)
app.use(i18n)

app.mount('#app')

miniToastr.init({ timeout: 10000 })
