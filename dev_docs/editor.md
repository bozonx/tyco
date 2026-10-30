# Editor

The main editor is a CodeMirror 6 view over Markdown
(`apps/desktop-ui/src/components/editor/`, logic in
`apps/desktop-ui/src/lib/editor/`). The `editor-input` store owns the text and
the selection; the view mirrors them.

## Store and view

- `EditorInput.vue` creates the view with `createEditorState` and forwards user
  edits to the store. Store edits reach the view only through `applyStoreEdit`
  (`editor-sync.ts`), which applies the minimal change and the new selection in
  one transaction marked `fromStore`, so they are not echoed back.
- Every programmatic edit has an `EditSource` (`edit-source.ts`). AI results,
  speech, paste and clearing are separate undo steps; typing is merged as usual.
- Delayed edits (plugins, AI, formatters) go through snapshots:
  `getSnapshot()` and `applySnapshotEdit(snapshot, text, scope)` apply the
  result only while the document, selection and revision still match. A
  `document` edit keeps the caret at its old offset, clamped to the new text.

## Keys

| Keys            | Action                                                                |
| --------------- | --------------------------------------------------------------------- |
| Ctrl+B / I / E  | Bold, italic, inline code (toggles)                                   |
| Ctrl+Shift+X    | Strikethrough                                                         |
| Ctrl+K          | Link from the selection                                               |
| Tab / Shift+Tab | Indent or outdent the selected lines or the list item under the caret |
| Ctrl+Shift+M    | Formatted view ↔ raw Markdown                                         |
| Ctrl+Shift+V    | Paste as plain text                                                   |
| Ctrl+Enter      | Quick actions                                                         |
| Ctrl+Z / Ctrl+Y | Undo / redo on any keyboard layout (`history-keys.ts`)                |

Tab stays in the editor (`indent-commands.ts`). Outside a list with no selection
it inserts the indent unit at the caret. The indent unit is four spaces, which
nests an item under both `- ` and `1. ` in CommonMark. Keyboard users leave the
editor with Escape followed by Tab (CodeMirror's tab focus mode).

Enter continues lists, tasks and quotes, and Backspace removes their markup
(`@codemirror/lang-markdown`).

## Markup menu

The context menu's Markup submenu (`markup-menu.ts`) runs the commands of
`markdown-commands.ts`: inline marks, link, headings 1–3, bullet, numbered and
task lists, quote, and the raw-Markdown switch. Line commands keep the line's
indentation, replace another block prefix (a bullet becomes a task, a heading
changes level) and remove the prefix when every selected line already has it.

## Formatted view

`markdown-preview.ts` hides markup outside the lines touched by the selection
and replaces tables, images, rules and fenced code with widgets. Clicking a task
checkbox toggles `[ ]` / `[x]` as an undoable edit. Only embedded `data:` images
are shown; remote images appear as their label, since the app is offline.

Decorations come from a state field because block widgets need one. The field
is rebuilt on document, focus and syntax tree changes, and on selection changes
only when the set of active lines changes. Overlap checks use `range-index.ts`,
so a rebuild is linear in the document size.

## Paste and clipboard

Pasted HTML becomes Markdown (`html-to-markdown.ts`) in two undo steps: plain
text first, then its Markdown, so one Ctrl+Z drops only the formatting. HTML
from code editors is pasted as plain text. Menu commands use the async
clipboard and refuse to apply when the document or selection changed meanwhile.

## Transforms

Case and Format menus list core items first, then plugin items:

- Core: UPPERCASE, lowercase, strip Markdown, beautify Markdown
  (`lib/edit-menu/edit-menu-model.ts`).
- TextCase plugin: capitalize first letter, sentence case, Title Case, inverted
  case, and identifier styles (camelCase, PascalCase, snake_case,
  CONSTANT_CASE, kebab-case, identifier to text). Identifier styles work line by
  line and only on a selection.
- WebFormatter plugin: Prettier for JSON, JS/TS, HTML, CSS/SCSS/Less and XML;
  the whitespace around a selection is kept.
- Diacritics plugin: toolbar buttons add a combining mark to the selected
  letters. "Remove all diacritics" removes combining marks only: spacing
  characters such as `^` and `` ` `` stay, Cyrillic letters lose only stress
  (й, ё, ї, ў stay letters), and Japanese voiced kana are kept.

An item marked `selectionOnly` is disabled in menus while nothing is selected.
Toolbar buttons that open action menus find them by action ID, never by label.
