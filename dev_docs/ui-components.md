# UI component contracts

Shared controls live in `apps/desktop-ui/src/components/common`. Domain components
compose them and keep domain state and side effects outside visual primitives.

## Choosing a component

- Use `Button` for actions and `IconButton` for actions with an accessible label
  and no visible text. Their props share `ButtonProps`. Use `danger` or
  `danger-ghost` for destructive actions instead of overriding button colors.
- Use `FieldRow` for labels, hints and validation messages. Native field wrappers
  inherit its IDs, disabled state and validation through `useFieldControl`.
- `FieldInput`, `FieldTextArea` and `SearchInput` expose `TextControl`: `focus`,
  `isFocused`, `getSelection` and `select`. A parameterless `select` selects all
  text; explicit offsets set a range. Unsupported native selection returns null.
- Use the plain field appearance inside a composer or preview. Keep focus visible.
  Specialized inputs may add domain behavior, but should reuse the text controls
  and `useTextareaAutosize` instead of implementing native input adapters again.
- Use `InlineNotice` for guidance and operation feedback beside existing content.
  Choose `surface` or `sunken` appearance and compact density when needed. Set an
  announcement explicitly: passive guidance stays silent, operation feedback uses
  polite status, and urgent errors use assertive alerts.
- Use `StateMessage` when a region has no content, is loading, or cannot display
  content. Use toasts for transient feedback outside a specific region.
- Use `DisclosureHeader` for a disclosure trigger and `DisclosurePanel` for a
  complete collapsible card. The panel owns the body ID and border. Put adjacent
  controls in its action slot rather than nesting buttons inside the trigger.
- Use `SegmentedControl` for choosing a value, and `NavigationList` for navigation.
  Introduce tabs only when a product screen needs tab panels and keyboard tabs.
- Use `BaseDialog` for native modal behavior and `ConfirmModal` for confirmation.
  Keep action overlays separate from native modal dialogs.

## Floating surfaces

`useDismissibleLayer` coordinates global outside interaction and keyboard handling
for the top open layer. `useAnchoredPanel` measures anchored surfaces, flips them
near viewport edges, tracks resizing and scrolling, and preserves the anchor theme.
Context menus reuse the same viewport constraints with their own anchor geometry.

Keep tooltip, interactive popover and menu keyboard behavior separate. Teleported
menus resume the trigger's document Tab order and restore its focus on Escape.
Panels inside a native dialog stay inside that dialog's top layer.

## Styling and verification

Use semantic color, spacing, radius, typography and transition tokens. Add a token
for a repeated design decision rather than duplicating local values. Do not add a
wrapper component solely to replace a utility class.

The development UI catalog demonstrates shared contracts, including validation,
disclosures, plain text controls and viewport edge menus. Check keyboard navigation,
long content, light/dark/e-ink themes, high contrast and interface scaling there.
Browser tests cover real focus, layout and native dialogs; focused unit tests cover
selection, event forwarding, layer ordering and placement calculations.
