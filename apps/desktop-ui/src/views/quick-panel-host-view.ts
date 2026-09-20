import { defineComponent, h, Comment } from 'vue'

/**
 * Placeholder for the routes whose UI the quick panel renders. The panel lives
 * in `App.vue` and is never unmounted, so its route must not mount anything;
 * keeping the path routable is all this component is for, and navigation and
 * `isCurrent` checks keep working unchanged.
 */
export default defineComponent({
  name: 'QuickPanelHostView',
  render: () => h(Comment, 'rendered by QuickPanel'),
})
