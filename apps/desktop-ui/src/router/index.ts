import { createRouter, createMemoryHistory } from 'vue-router'
const HomeView = () => import('../views/HomeView.vue')
const HistoryView = () => import('../views/HistoryView.vue')
const SettingsView = () => import('../views/SettingsView.vue')
const ChatView = () => import('../views/ChatView.vue')
const WriteModeView = () => import('../views/WriteModeView.vue')
const VoiceView = () => import('../views/VoiceView.vue')
const SelectionActionsView = () => import('../views/SelectionActionsView.vue')
const AiTaskView = () => import('../views/AiTaskView.vue')
const CommandLauncherView = () => import('../views/CommandLauncherView.vue')
const CorrectionModeView = () => import('../views/CorrectionModeView.vue')
const TranslateModeView = () => import('../views/TranslateModeView.vue')
const EditorView = () => import('../views/EditorView.vue')
import { APP_ROUTES } from '../lib/navigation/routes'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
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
      component: WriteModeView,
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
      component: CorrectionModeView,
    },
    {
      path: APP_ROUTES.TRANSLATE.path,
      name: APP_ROUTES.TRANSLATE.name,
      component: TranslateModeView,
    },
    {
      path: APP_ROUTES.SELECT.path,
      name: APP_ROUTES.SELECT.name,
      component: SelectionActionsView,
    },
    {
      path: APP_ROUTES.COMMAND_LAUNCHER.path,
      name: APP_ROUTES.COMMAND_LAUNCHER.name,
      component: CommandLauncherView,
    },
  ],
})

export default router
