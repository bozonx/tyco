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
- Form controls use the named `v-model:value` contract. `FieldSelect` preserves
  the selected option's original ID type; callers must not depend on DOM string
  coercion. `FieldNumber` returns a string so empty/intermediate input remains
  representable; business models parse and validate it.
- `FieldRow` provides labels, hints, errors, disabled and required state to common
  controls through `useFieldControl`. Put tooltip buttons outside native labels.
  Composite controls must forward native attributes to their actual control.
- `Tabs` represents panels: provide a localized label and the `panel` slot, or
  supply `panelId` and a corresponding external `tabpanel` with `aria-labelledby`.
  It uses a single Tab stop and arrow/Home/End navigation. `kind="navigation"`
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
interface. Settings navigation collapses at 45rem; chat navigation at 47.5rem,
reflecting their different content needs. Keep CSS and matchMedia thresholds
synchronized. Section headers should wrap when actions compete with long titles.

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
failing tests retain screenshots and traces. These are review artifacts, not
pixel baselines. Native Tauri smoke tests remain necessary for webview-specific
behavior.

## Settings models

Keep business edits and validation in tested DI models. Command editing and
undoable removal live in `lib/commands/*-model.ts`; LLM key operations, connection
state and numeric edits live in `lib/llm/llm-settings-model.ts`. Components retain
translation, rendering, focus, and dependency wiring.
