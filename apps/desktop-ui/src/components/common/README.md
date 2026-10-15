# Shared UI contracts

- Shared value controls use `modelValue` and `update:modelValue` (`v-model`). Numeric inputs emit strings so empty and unfinished input remain distinguishable; parsing belongs to the domain adapter.
- Use `FieldRow` for visible labels, descriptions, errors, warnings, disabled and required state. Controls consume its context through `useFieldControl`. Use `vertical` with `density="compact"` in card editors and `separator="false"` when the surrounding layout owns dividers. The `messages` slot connects domain-specific warnings to the control description.
- Use `Button` for ordinary actions and `IconButton` for icon-only actions with a required accessible label. Both share size and variant contracts. Use `danger-ghost` for quiet destructive actions. Button exposes `focus()` for keyboard-driven popovers.
- Use `Tabs` for switching associated panels and `NavigationList` for navigating application sections. Use `SegmentedControl` for choosing a value. Shared visual tokens do not imply shared accessibility semantics.
- `MenuSurface` and `MenuItem` own menu presentation. Dropdown and editor menus retain their own positioning, dismissal and selection behavior. Native menu buttons keep menu keyboard semantics instead of ordinary button styling.
- `DisclosureHeader` owns the expanded state announcement and shared header presentation. Its parent owns state, stable body IDs and lazy body rendering. Put sibling actions outside the disclosure button.
- `ConfigFieldControl` renders a prepared control description. `ConfigFields` owns configuration defaults; `ToolConfigFields` owns command overrides and plugin inheritance. An inherited boolean is distinct from explicit `false`.
- Configure a child through its public props, slots or documented CSS tokens. Avoid reaching into child classes with parent `:deep` selectors. Styles for generated Markdown and third-party editors remain local to their rendering adapters.
- Add shared component states to `src/dev/UiCatalog.vue`. Verify keyboard behavior, long labels, narrow layouts, light/dark/e-ink themes, high contrast, reduced motion and interface scaling in the browser catalog tests.
