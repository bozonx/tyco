import { createRouter, createMemoryHistory } from "vue-router";
import HomeView from "../views/HomeView.vue";
import HistoryView from "../views/HistoryView.vue";
import ConfigView from "../views/ConfigView.vue";
import ChatView from "../views/ChatView.vue";
import WriteModeView from "../views/WriteModeView.vue";
import VoiceView from "../views/VoiceView.vue";
import SelectModeView from "../views/SelectModeView.vue";
import AiTaskView from "../views/AiTaskView.vue";
import EditorView from "../views/EditorView.vue";
import { APP_ROUTES } from "../lib/navigation/routes";

const router = createRouter({
  history: createMemoryHistory(),
  // history: createWebHistory(import.meta.env.BASE_URL),
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
      props: true,
    },
    {
      path: APP_ROUTES.HISTORY.path,
      name: APP_ROUTES.HISTORY.name,
      component: HistoryView,
    },
    {
      path: APP_ROUTES.CONFIG.path,
      name: APP_ROUTES.CONFIG.name,
      component: ConfigView,
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
      path: APP_ROUTES.SELECT.path,
      name: APP_ROUTES.SELECT.name,
      component: SelectModeView,
    },
  ],
});

export default router;
