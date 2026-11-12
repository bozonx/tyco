# UI system

Vue and Tailwind are the UI system. Shared primitives live in
`apps/desktop-ui/src/components/common`; the palettes live in
`assets/styles/themes.css`, semantic appearance tokens in `tokens.css`, the base
looks of the native controls (`.btn`, `.input`, `.select`, `.textarea`,
`.toggle`, `.checkbox`, `.kbd`, `.loading`) in `controls.css` and their app
refinements in `components.css`. There is no component library. Assets must
remain bundled and work offline.

## Component contracts

- `Button`: use `variant="primary|neutral|ghost|danger|danger-ghost"` and
  `size="xs|sm|md"`. The default is neutral/md; a view's main action states
  `variant="primary"` explicitly. `loading` blocks activation, exposes `aria-busy`
  and preserves the label beside a decorative spinner. Do not reintroduce boolean
  variant/size aliases. Shared types live in `lib/ui/control-types.ts`.
  Delete and remove buttons must not be red: never use `danger` or `danger-ghost`
  for delete actions; use regular buttons (`neutral` or `ghost`, or `primary` for
  dialog confirmation).
- `ShortcutButton`: use `variant="primary|ghost"` and `size="xs|sm|md"`;
  the default is ghost/md. Quick surface footer actions use this control with
  visible borders and text labels, without icons. `ShortcutKeys` separates
  alternative shortcuts with commas and modifier chords with plus signs.
- `DropdownMenu`: use the same size/variant names as `Button`; default ghost/sm.
- `IconButton`: provide a localized `label` and an `icon`. The label supplies the
  accessible name and native tooltip. Use this for icon-only actions.
- Editable controls use `modelValue` and `update:modelValue` (`v-model`). `FieldSelect` preserves
  the selected option's original ID type; callers must not depend on DOM string
  coercion. `FieldNumber` returns a string so empty/intermediate input remains
  representable; business models parse and validate it.
- `FieldInput`, `FieldTextArea` and `SearchInput` expose `TextControl`: `focus`,
  `isFocused`, `getSelection` and `select`. A parameterless `select` selects all
  text; explicit offsets set a range. Unsupported native selection returns null.
  Use the plain field appearance inside a composer or preview and keep focus
  visible. Specialized inputs reuse these controls and `useTextareaAutosize`
  instead of implementing native input adapters again.
- `FieldRow` provides labels, hints, errors, disabled and required state to common
  controls through `useFieldControl`. Put tooltip buttons outside native labels.
  Composite controls must forward native attributes to their actual control.
- `NavigationList` uses ordinary buttons and `aria-current` for section
  navigation.
- `SegmentedControl` selects a value through native radios.
- `AppIcon` sizes come from `lib/ui/icon-size.ts` in rem, so icons follow the
  interface scale. Do not size icons in pixels.
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

## Floating surfaces

`useDismissibleLayer` coordinates global outside interaction and keyboard handling
for the top open layer. `useAnchoredPanel` measures anchored surfaces, flips them
near viewport edges, tracks resizing and scrolling, and preserves the anchor theme.
Context menus reuse the same viewport constraints with their own anchor geometry.
Keep tooltip, interactive popover and menu keyboard behavior separate. Teleported
menus resume the trigger's document Tab order and restore its focus on Escape.
Panels inside a native dialog stay inside that dialog's top layer.

## Styling

Use Tailwind for layout and shared primitives for interaction. Scoped CSS should
reference semantic `--app-*` tokens for appearance. Use the typography and
control-size tokens rather than introducing slightly different values per screen.
Add a token for a repeated design decision rather than duplicating local values;
do not add a wrapper component solely to replace a utility class.
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
`pnpm test:browser:container ui-catalog.spec.ts --project=chromium --update-snapshots`
in the CI image, see `dev_docs/testing.md`. Native Tauri smoke tests remain
necessary for webview-specific behavior.

The screenshot selector tracks one pointer and listens for movement and release
on the window while it holds pointer capture. Capture loss, cancellation, window
blur and a mouse returning with its button released finish the current rectangle
without resetting its endpoint. Pointer defaults and touch panning are disabled
during selection; the size badge and confirmation stay within the viewport even
when a rectangle touches its edges. `screenshot-selector.spec.ts` exercises edge
drags and direction changes in Chromium and WebKit.

## Settings models

`Settings.vue` provides a `SettingsContext` (`lib/settings/settings-context.ts`)
to its tabs: the session draft, `settings-operations`, the effective UI language
and `navigate`/`editCommand`. A tab reads it with `useSettingsContext()`, edits
the draft in place and emits nothing; detail tabs take only their entity id or
plugin as a prop. The navigation tree, tab availability and titles live in
`lib/settings/settings-navigation.ts`. A detail page uses `SettingsDetailHeader`
and saves automatically, showing `SettingsAutosaveStatus`; only creating an
entity waits for an explicit button.

Keep business edits and validation in tested DI models. Command editing and
undoable removal live in `lib/commands/*-model.ts`; LLM key operations, connection
state and numeric edits live in `lib/llm/llm-settings-model.ts`. Components retain
translation, rendering, focus, and dependency wiring.

Settings reuse `VaultFolderField` for suggested vault IDs, `ModelNumberField`
for model/profile numeric controls, and `SettingsAdvancedFields` for their
additional options. The caller owns field values and validation; these components
render them and emit edits. `SettingsHistoryClear` owns confirmation and busy
feedback for clearing a history scope. Retention confirmations and editor history
policy edits live in `lib/history/*-settings-model.ts`.

Profile memory uses separate injected models for topics, file editing and
compaction in `lib/ai-profiles/memory-*-model.ts`. File reads publish the file name
and content together; request revisions suppress stale results after closing,
changing profiles, disabling memory or disposal. Writes retain their original
profile/file identity, and compaction updates an open editor only if its source
text still matches. The component wires stores, translates messages and disposes
these models.

## Shared control conventions

UI options use `id` and `name` (`ControlOption`); plugin SDK serialization is
adapted explicitly. `size="xs|sm|md"` controls dimensions; `density="default|compact"`
controls layout spacing. `NavigationList.isCollapsed` describes rail visibility.

## Choosing a component

Domain components compose the shared controls and keep domain state and side
effects outside visual primitives.

| Requirement                                | Component                              |
| ------------------------------------------ | -------------------------------------- |
| An action with visible text                | `Button`                               |
| An action with an icon only                | `IconButton`                           |
| Select an item or acknowledge a condition  | `FieldCheckbox`                        |
| Enable or disable a feature                | `FieldSwitch`                          |
| Choose one value                           | `FieldSelect` or `SegmentedControl`    |
| Navigate between settings pages            | `NavigationList`                       |
| A disclosure trigger / collapsible card    | `DisclosureHeader` / `DisclosurePanel` |
| Show noninteractive explanatory text       | `InfoTooltip`                          |
| Show help containing buttons or links      | `InfoPopover`                          |
| Label a state or count                     | `Badge`                                |
| Activate a compact labeled marker          | `Badge interactive`                    |
| Show a keyboard hint, optionally clickable | `ShortcutHint`                         |
| Show a full action with keyboard keys      | `ShortcutButton`                       |
| Guidance or feedback beside content        | `InlineNotice`                         |
| Show an empty, loading or error state      | `StateMessage`                         |
| Transient feedback outside a region        | a toast                                |
| Display a modal dialog                     | `BaseDialog` and domain dialog content |
| Ask for confirmation                       | `ConfirmModal`                         |
| Display the action window surface          | `Overlay`                              |

Introduce tabs only when a product screen needs tab panels and keyboard tabs.
Keep action overlays separate from native modal dialogs.

`InlineNotice` has `surface` or `sunken` appearance and compact density. Set its
announcement explicitly: passive guidance stays silent, operation feedback uses
polite status, urgent errors use assertive alerts. `DisclosurePanel` owns the
body ID and border; put adjacent controls in its action slot rather than
nesting buttons inside the trigger.

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
`TranslationToolFields`, `AiCommandToolFields` (AI commands) and
`PromptToolFields` (transformations and styles) own the built-in tool forms;
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

## Quick AI request results

A completed quick request collapses its composer into result actions. The latest
answer's completed `propose_replies` blocks supply insertion: one block is selected
automatically; multiple blocks require an explicit choice. Plain informational
answers have no primary insertion action. Another request reopens and focuses the
composer with the conversation context preserved; errors and stopped turns keep
the composer available. The chat button continues in the main chat.

Enter and Space insert the selected result only outside interactive controls,
after generation completes. Repeated keys, composition, modifiers and selected
text must not trigger insertion. Insertion is guarded while it is in progress.
Reply-tool instructions are English and request one complete variant by default;
multiple variants require an explicit user request.

## Voice input from actions

The standard `voiceInput` action is assignable in the action picker and occupies
B on the first default action page. It opens dictation with the action's source
text displayed as a scrollable reference. The reference belongs to that voice
activation only; it is neither inserted with the transcript nor sent as an AI
instruction. Listening results use the same action menu without a separate
reply-by-voice primary button.

## Quick surface keyboard actions

Request composers share the configured Enter/Ctrl+Enter submit key. Shift+Enter
always inserts a newline; bare Enter also inserts one in Ctrl+Enter mode.
Outside text entry, Enter/Space runs the primary action and Shift+Space runs
the secondary action. Tab opens the next action menu in quick input and voice
flows. On the action menu, Tab moves the text to the editor. Result views
keep an explicit editor button; intermediate input and picker views do not. Escape returns or cancels; Shift+Escape closes the whole flow.
Ctrl+Enter is reserved for configured request submission, not editor actions
or immediate voice completion.

Quick surface action rows follow DOM and visual order from left to right:
Other actions, Tab/action menu, secondary action, primary action.
Escape/cancel appears once in the header, not in the footer.
Rows align to the right; avoid CSS order overrides so focus follows the display.

## Changing a quick text workflow

A quick AI voice request always offers returning to its composer, including
silent recordings and STT start errors. Shift+Space sends the dictated prompt immediately. Unsent AI prompts do not
expose actions. The request header offers Back when there is a previous step;
a directly opened quick request with a selection offers Actions for that original
selection, independently of the prompt draft. Without a selection it is hidden.
Completed plain answers expose actions even without proposed reply variants;
when variants exist, actions use the selected variant.

External dictation keeps Tab to finish into the action menu. The recording
surface has no separate edit-text action; text can be edited in the action menu. Explicit UI text travels as `quickInputText` in the
activation snapshot, so transfer also works across windows; captured selections
do not overwrite the quick-input draft. Reviewed voice commands expose Tab/actions for their
editable text and restore the review when returning from the action menu.

Switching microphone/system-audio sources finalizes the current recording first.
The finalized text is handed to the next activation and prepended to its live
transcript and final result. A failed switch keeps text in the source's result
step; a failed destination start keeps the carried text actionable. Handoffs are
single-use and scoped to the destination mode and activation ID.

## Result review editing

`DiffMenu` owns a result draft shared by all view modes and result actions.
Split and result views allow editing; original and unified views remain read-only.
Reset restores the incoming result. `Diff` stays read-only unless `editable` is
set. `ResultTextEditor` layers optional diff backgrounds behind a plain text control so
typing preserves native selection, undo and multiline input. Keyboard events
stay inside the control while editing. Conflict replacement receives the reviewed
draft and still checks the editor snapshot before applying it.

Translation review (`PreviewMenu`) and `ParallelTextPreview` use the same
`ResultTextEditor` as diff review. Both review screens reset their draft to the
incoming result and pass the current draft to subsequent actions.

## Result editing keys

Preview and diff result fields keep typing keys, including Tab, inside the
field. Escape blurs the result field; the next Escape follows overlay navigation.
Shift+Escape reaches the overlay to close all menus even while editing.
Outside text fields, Tab inserts the result into the editor; its action button
shows the binding in both preview and diff menus.

Silent voice completion keeps the stopped voice surface available for retry and
reports the empty recognition in a toast. Existing chat input returns to editing
when submission contains no new speech. An unchanged correction is a successful
result; its status is shown in a toast rather than the result header. Empty
correction responses are failures and must not replace the source text.

## Overlay navigation

Overlay headers separate Back (Esc) from the close cross (Shift+Esc). Escape
returns one step and closes at the root. The cross closes the entire scenario.
Directly opened translation, transformation, styling, favorites, chat prompts and
voice commands offer Other actions without a shortcut. A root quick AI composer
offers it only for an original selection. Input, recording and result surfaces
do not offer this scenario switch. Other actions preserves the source text and
replaces the stack with the action menu, so Back cannot restore the old scenario.
The action menu text is editable and its draft persists when returning from a step.
