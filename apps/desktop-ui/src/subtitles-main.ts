/**
 * The subtitles window of the dialog. It renders what the main window publishes
 * and nothing else, so it loads neither the stores nor the router.
 */
import { createApp } from 'vue'

import './assets/main.css'
import SubtitlesOverlay from './components/dialog/SubtitlesOverlay.vue'
import { registerOfflineIcons } from './lib/icons'
import { clientLogger } from './lib/logger'
import { installButtonMouseFocusPolicy } from './lib/ui/focus'

registerOfflineIcons()

const app = createApp(SubtitlesOverlay)
clientLogger.setupGlobalHandlers(app)
installButtonMouseFocusPolicy()
app.mount('#app')
