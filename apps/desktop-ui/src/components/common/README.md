# Shared UI contracts

`common/` holds the primitives only: controls, fields, menus, dialogs,
disclosures, notices and previews. Domain compositions live in their feature
folders: `settings/` (`SettingsSection`, `ConfigFields`, `HotkeyInput`,
`ShortcutSlots`, the settings building blocks), `overlay/` (`Overlay`,
`ActionOverlayLayout`, `ShortcutList`, `ShortcutButton`, `ShortcutHint`,
`SelectionContextPreview`), `menu/` and `app/`. Components are imported
explicitly; there is no auto-import.

- Shared value controls use `modelValue` and `update:modelValue` (`v-model`). Numeric inputs emit strings so empty and unfinished input remain distinguishable; parsing belongs to the domain adapter.
- Use `FieldRow` for visible labels, descriptions, errors, warnings, disabled and required state. Controls consume its context through `useFieldControl`. Use `vertical` with `density="compact"` in card editors, `inline` for horizontal control rows with trailing switches or buttons, and `separator="false"` when the surrounding layout owns dividers. The `messages` slot connects domain-specific warnings to the control description.
- Use `Button` for ordinary actions and `IconButton` for icon-only actions with a required accessible label. Both share size and variant contracts. `Button` defaults to `neutral`; mark the main action of a view `variant="primary"` explicitly. `IconButton` defaults to `ghost`. Use `danger-ghost` for quiet destructive actions. Button exposes `focus()` for keyboard-driven popovers.
- `AppIcon` takes `size="xs|sm|md|lg|xl|2xl|3xl|4xl"` (12–32px at 100%). The sizes are in rem and follow the interface scale; never size an icon with pixel `width`/`height`. Without a size an icon is `1em` and follows the text.
- `CopyButton` copies a plain value and shows a check for a moment; `useCopyValue` does the same for menu actions. A refused clipboard is always reported. Do not call `navigator.clipboard` from components.
- Use `NavigationList` for navigating application sections and `SegmentedControl` for choosing a value. Shared visual tokens do not imply shared accessibility semantics.
- `MenuSurface` and `MenuItem` own menu presentation. Dropdown and editor menus retain their own positioning, dismissal and selection behavior. Native menu buttons keep menu keyboard semantics instead of ordinary button styling.
- `DisclosureHeader` owns the expanded state announcement and shared header presentation. Its parent owns state, stable body IDs and lazy body rendering. Put sibling actions outside the disclosure button. Every expandable block uses it rather than a hand-made toggle or `<details>`. It accepts `iconSize` and the CSS tokens `--disclosure-padding`, `--disclosure-background` and `--disclosure-hover-background`; `DisclosurePanel` accepts `--disclosure-panel-border-color`, `--disclosure-panel-header-padding` and `--disclosure-panel-header-gap`.
- `ConfigFieldControl` renders a prepared control description. `ConfigFields` owns configuration defaults; `ToolConfigFields` owns command overrides and plugin inheritance. An inherited boolean is distinct from explicit `false`.
- Configure a child through its public props, slots or documented CSS tokens. Avoid reaching into child classes with parent `:deep` selectors. Styles for generated Markdown and third-party editors remain local to their rendering adapters.
- Add shared component states to `src/dev/UiCatalog.vue`. Verify keyboard behavior, long labels, narrow layouts, light/dark/e-ink themes, high contrast, reduced motion and interface scaling in the browser catalog tests.

## Appearance and composition

- `FieldRow group` renders a named fieldset for composite values or multiple controls. Give controls distinct accessible names where they represent different values. Ordinary rows retain a native label associated with their control. Segmented controls put native `disabled` and `required` on radios and expose group state through ARIA.
- `InlineNotice` is for compact contextual guidance and feedback; `StateMessage` is for an area's empty, loading or failed state. Notices default to no announcement. Choose `polite` for asynchronous feedback and `assertive` only for urgent errors.
- `Button`, `IconButton`, and `DropdownMenu` accept `tone="muted"` or `tone="accent"` for ghost actions. Containers may set `--button-ghost-color` as their default; destructive actions use `danger-ghost` and keep their own color.
- `TextPreview` and `Diff` accept `appearance="framed" | "plain"`. `ActionOverlayLayout` provides a plain default through `previewAppearanceKey`; an explicit appearance overrides it. The layout owns the outer frame, and text/diff content owns scrolling. Preview typography uses `--preview-font-size` and `--preview-line-height`.
- `AudioWaveform layout="inline"` owns the recording bar layout; the default remains stacked. `compact` controls waveform amplitude independently.
- `KeyboardKey` exposes `--key-size`, `--key-font-size`, `--key-border-color`, `--key-color`, and `--key-background`. `ShortcutButton` sets these for its keys and accepts inherited `--shortcut-width`, `--shortcut-flex`, and `--shortcut-max-width` for layout.
- Keep domain compositions in their feature folders: `ChatComposer` owns input controls and attachment notices, `LlmModelEditor` owns model fields, and `CommandVoiceFields` owns voice command configuration. Their parents retain conversation scrolling, provider management, and command updates respectively.
