# UI system

The existing Vue, Tailwind and daisyUI stack is the UI system. Shared primitives
live in `apps/desktop-ui/src/components/common`; semantic appearance tokens live
in `assets/styles/tokens.css`. Assets must remain bundled and work offline.

## Component contracts

- `Button`: use `variant="primary|neutral|ghost|danger"` and `size="xs|sm|md"`.
  Omit size for the default size. `loading` blocks activation, exposes `aria-busy`
  and preserves the label beside a decorative spinner. Do not reintroduce boolean
  variant/size aliases. Shared types live in `lib/ui/control-types.ts`.
- `ShortcutButton`: use `variant="primary|ghost"` and `size="xs|sm|md"`;
  the default is ghost/md. Keep keyboard hints in this specialized control.
- `DropdownMenu`: use the same size/variant names as `Button`; default ghost/sm.
- `IconButton`: provide a localized `label` and an `icon`. The label supplies the
  accessible name and native tooltip. Use this for icon-only actions.
- Editable controls use `modelValue` and `update:modelValue` (`v-model`). `FieldSelect` preserves
  the selected option's original ID type; callers must not depend on DOM string
  coercion. `FieldNumber` returns a string so empty/intermediate input remains
  representable; business models parse and validate it.
- `FieldRow` provides labels, hints, errors, disabled and required state to common
  controls through `useFieldControl`. Put tooltip buttons outside native labels.
  Composite controls must forward native attributes to their actual control.
- `Tabs` represents panels: provide a localized label and the `panel` slot, or
  supply `panelId` and a corresponding external `tabpanel` with `aria-labelledby`.
  It uses a single Tab stop and arrow/Home/End navigation. `NavigationList`
  uses ordinary buttons and `aria-current` for section navigation.
- `SegmentedControl` selects a value through native radios. Share segment tokens
  with tabs, but preserve radio semantics.
- `BaseDialog` uses native `showModal()` for focus containment and inert background.
  Supply `labelledby` (visible title) or a localized `label`. The parent owns
  `open` and handles `close`; `ConfirmModal` supplies confirmation actions and
  initial focus on Cancel. Do not attach a second global Escape handler.
- `DropdownMenu` uses menu semantics and arrow/Home/End navigation; Escape and
  selection restore trigger focus. `usePopover` owns outside-click and focus exit.
- `EditorContextMenu` shares `lib/ui/menu-navigation.ts` with `DropdownMenu`.
  Both support arrow/Home/End movement. Context menus skip disabled items, use
  one composite focus sequence, and close on Tab or focus exit. Submenu focus
  waits until placement has been rendered.
- `StateMessage` standardizes empty/loading/error/info presentation. Keep domain text
  and retry callbacks in the screen. Loading uses `status`, errors use `alert`.

## Styling

Use Tailwind for layout and shared primitives for interaction. Scoped CSS should
reference semantic `--app-*` tokens for appearance. Use the typography and
control-size tokens rather than introducing slightly different values per screen.
Use the named z-index layers; native modal dialogs occupy the browser top layer.
Quick surfaces use `--app-quick-surface`, `--app-quick-hint-surface` and
`--app-quick-backdrop`; e-ink makes them opaque and removes blur. Focus states use
`--app-focus-ring`. Use `--text-micro` for metadata and `--text-heading` for larger
page headings.

`FieldRow` adapts at a container width of 40rem; `ui-form-container` and settings sections
provide size containers. The field label width is in rem and scales with the
interface. Settings navigation labels collapse when their container is below 8rem; the
settings shell still controls its rail layout. Chat navigation collapses at
47.5rem. Keep shell CSS and matchMedia thresholds synchronized. Section headers should wrap when actions compete with long titles.

A component-specific dimension is allowed where it represents actual content,
such as image previews. Do not replace every dimension with an arbitrary token.

Test light, dark and e-ink, high contrast, reduced motion, increased interface
scale, and narrow windows. Keep all accessible names localized in every locale.

## Local catalog

Run `pnpm dev:ui` and open `/ui-catalog.html` on the configured Vite port
(default 3000). The catalog has no IPC startup dependency and is excluded from the
production build. Its English examples are developer fixtures.

Use it to check control states, dialog keyboard focus, menu keyboard navigation,
tabs, appearance modifiers and 100–150% scaling. Unit tests verify component
contracts and DI models; browser checks verify native dialog behavior and layout.

## Browser verification

Run `pnpm --filter @tyco/desktop-ui exec playwright install chromium` once, then
`pnpm --filter @tyco/desktop-ui test:browser`. To use an installed browser, set
`TYCO_BROWSER_PATH` to its executable path. The test runner starts its own Vite
server and does not require IPC or a running Tauri process.

The suite verifies tabs, menus, submenus, Tab exit, native dialog focus containment,
Escape, and nested dialog focus restoration. It also checks layout at 480px and
1000px, 150% scale, high contrast and reduced motion across all three themes.
Each appearance case writes `catalog.png` under `apps/desktop-ui/test-results`;
failing tests retain screenshots and traces. The standard-controls section also has reviewed pixel baselines in
`browser-tests/ui-catalog.spec.ts-snapshots`. Refresh intentional changes with
`pnpm --filter @tyco/desktop-ui exec playwright test --update-snapshots`. Native Tauri smoke tests remain necessary for webview-specific
behavior.

## Settings models

Keep business edits and validation in tested DI models. Command editing and
undoable removal live in `lib/commands/*-model.ts`; LLM key operations, connection
state and numeric edits live in `lib/llm/llm-settings-model.ts`. Components retain
translation, rendering, focus, and dependency wiring.

## Shared control conventions

UI options use `id` and `name` (`ControlOption`); plugin SDK serialization is
adapted explicitly. `size="xs|sm|md"` controls dimensions; `density="default|compact"`
controls layout spacing. `NavigationList.isCollapsed` describes rail visibility.

## Choosing a component

| Requirement                                | Component                              |
| ------------------------------------------ | -------------------------------------- |
| Select an item or acknowledge a condition  | `FieldCheckbox`                        |
| Enable or disable a feature                | `FieldSwitch`                          |
| Choose one value                           | `FieldSelect` or `SegmentedControl`    |
| Switch between content panels              | `Tabs`                                 |
| Navigate between settings pages            | `NavigationList`                       |
| Show noninteractive explanatory text       | `InfoTooltip`                          |
| Show help containing buttons or links      | `InfoPopover`                          |
| Label a state or count                     | `Badge`                                |
| Activate a compact labeled marker          | `Badge interactive`                    |
| Show a keyboard hint, optionally clickable | `ShortcutHint`                         |
| Show a full action with keyboard keys      | `ShortcutButton`                       |
| Show an inline notification                | `InlineNotice`                         |
| Show an empty, loading or error state      | `StateMessage`                         |
| Display a modal dialog                     | `BaseDialog` and domain dialog content |
| Display the action window surface          | `Overlay`                              |

`BooleanControl` and `InfoBubble` are implementation components. Screens use
`FieldCheckbox`/`FieldSwitch` and `InfoTooltip`/`InfoPopover` respectively.

`InfoPopover` opens from click or ArrowDown, focuses its first action, closes on
Escape and restores the trigger focus. Tab leaves the panel through the normal
page order. Text tooltips keep focus on their trigger.

## Fields and domain adapters

`FieldRow` owns field layout. `useFieldContext` owns generated IDs, control
registration and inherited accessible state. `FieldMessages` owns message
presentation. Supply translated strings through `error` and `warning`; use the
`messages` slot only for additional structured content. Multiple related
controls use `group` and each control supplies its own accessible name.

`ConfigFieldControl` renders a normalized control description. `ConfigFields`
adapts plugin settings. `PluginToolFields` adapts command overrides, preserving
inheritance and explicit `false`. These value semantics must stay separate.
`TranslationToolFields` and `AiTaskToolFields` own the built-in tool forms;
`ToolConfigFields` selects the form.

Keep parsing and asynchronous settings behavior in injected models under
`src/lib/`, with focused unit tests. Views wire dependencies and translate
messages. The translation settings model follows this arrangement.

## Sorting and responsive layout

Use `DragHandle` with `useSortableList`. Reordering is handled via drag-and-drop.

Reusable controls respond to their available container width. Navigation uses
a named container, split previews stack below 40rem, and result controls
hide their labels below a 40rem ancestor container. Field rows stack below 40rem. These thresholds
represent different content constraints, not different global device categories.
Viewport queries remain appropriate for application-level window layout.
