import { createRouter, createMemoryHistory } from 'vue-router'

import { clientLogger } from '../lib/logger'
import { APP_ROUTES } from '../lib/navigation/routes'
import AiTaskView from '../views/AiTaskView.vue'
import ChatView from '../views/ChatView.vue'
import CommandLauncherView from '../views/CommandLauncherView.vue'
import CorrectionView from '../views/CorrectionView.vue'
import EditorView from '../views/EditorView.vue'
import HistoryView from '../views/HistoryView.vue'
import HomeView from '../views/HomeView.vue'
import SelectionView from '../views/SelectionView.vue'
import SettingsView from '../views/SettingsView.vue'
import TranslateView from '../views/TranslateView.vue'
import VoiceCommandsView from '../views/VoiceCommandsView.vue'
import VoiceView from '../views/VoiceView.vue'
import WriteView from '../views/WriteView.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: APP_ROUTES.VOICE_COMMANDS.path,
      name: APP_ROUTES.VOICE_COMMANDS.name,
      component: VoiceCommandsView,
    },
    {
      path: APP_ROUTES.HOME.path,
      name: APP_ROUTES.HOME.name,
      component: HomeView,
      props: true,
    },
    {
      path: APP_ROUTES.EDITOR.path,
      name: APP_ROUTES.EDITOR.name,
      component: EditorView,
    },
    {
      path: APP_ROUTES.HISTORY.path,
      name: APP_ROUTES.HISTORY.name,
      component: HistoryView,
    },
    {
      path: APP_ROUTES.CONFIG.path,
      name: APP_ROUTES.CONFIG.name,
      component: SettingsView,
    },
    {
      path: APP_ROUTES.CHAT.path,
      name: APP_ROUTES.CHAT.name,
      component: ChatView,
      props: true,
    },
    {
      path: APP_ROUTES.WRITE.path,
      name: APP_ROUTES.WRITE.name,
      component: WriteView,
    },
    {
      path: APP_ROUTES.VOICE.path,
      name: APP_ROUTES.VOICE.name,
      component: VoiceView,
    },
    {
      path: APP_ROUTES.AI_TASKS.path,
      name: APP_ROUTES.AI_TASKS.name,
      component: AiTaskView,
    },
    {
      path: APP_ROUTES.CORRECTION.path,
      name: APP_ROUTES.CORRECTION.name,
      component: CorrectionView,
    },
    {
      path: APP_ROUTES.TRANSLATE.path,
      name: APP_ROUTES.TRANSLATE.name,
      component: TranslateView,
    },
    {
      path: APP_ROUTES.SELECT.path,
      name: APP_ROUTES.SELECT.name,
      component: SelectionView,
    },
    {
      path: APP_ROUTES.COMMAND_LAUNCHER.path,
      name: APP_ROUTES.COMMAND_LAUNCHER.name,
      component: CommandLauncherView,
    },
  ],
})

router.onError((error) => {
  clientLogger.error('Navigation error', error, 'router')
})

export default router
