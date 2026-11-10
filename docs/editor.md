# Editor

The main editor writes Markdown. By default it shows the text formatted, and
the markup appears only on the lines you are editing. Press **Ctrl+Shift+M** to
switch between the formatted view and raw Markdown.

## Keyboard shortcuts

| Keys                 | Action                                               |
| -------------------- | ---------------------------------------------------- |
| Ctrl+B / Ctrl+I      | Bold / italic                                        |
| Ctrl+E               | Inline code                                          |
| Ctrl+Shift+X         | Strikethrough                                        |
| Ctrl+K               | Make a link from the selection                       |
| Ctrl+0               | Normal text (removes a heading, list or quote)       |
| Ctrl+1 … Ctrl+3      | Heading level 1–3                                    |
| Ctrl+Shift+8 / 7 / 9 | Bulleted, numbered and task list                     |
| Ctrl+Shift+.         | Quote                                                |
| Tab / Shift+Tab      | Indent / outdent the selected lines or the list item |
| Ctrl+Shift+M         | Formatted view ↔ raw Markdown                        |
| Ctrl+F / Ctrl+H      | Search / search and replace                          |
| Ctrl+Shift+V         | Paste as plain text                                  |
| Ctrl+Enter           | Quick actions                                        |
| Ctrl+Z / Ctrl+Y      | Undo / redo (any keyboard layout)                    |

The formatting, indentation and view shortcuts can be changed in **Settings →
Hotkeys**, section **Editor**. Headings 4–6 have no shortcut by default. Clear
a binding to turn the shortcut off. A shortcut that is already taken by another
editor command, by basic editing or by a global hotkey is refused. With a
non-Latin layout the shortcuts follow the key positions of the Latin layout.

Enter continues a list, task list or quote; Backspace removes its markup. Tab
stays in the editor. To leave the editor with the keyboard, press Escape and
then Tab.

## Formatting from the menu

The context menu has a **Markup** submenu with the same commands, plus headings
1–6. Applying a list or heading to lines that already have one replaces it;
applying it again removes it. Code blocks are never changed by formatting
commands.

In the formatted view, tables, rules, code blocks and embedded images are
drawn as they will look. Clicking the checkbox of a task toggles it. Images
from the internet are shown only as their label: the editor works offline.

## Pasting

Text copied from a web page or a document is pasted as Markdown. If you want
the plain text instead, press Ctrl+Z once: the formatting goes, the text stays.
Text copied from code editors is always pasted as plain text.

## Case and format

The **Case** and **Format** menus change the selection, or the whole text when
nothing is selected:

- UPPERCASE, lowercase, remove Markdown, tidy Markdown;
- with the TextCase plugin: capital first letter, sentence case, Title Case,
  inverted case and identifier styles (camelCase, snake_case, kebab-case, …;
  these work only on a selection, line by line);
- with the WebFormatter plugin: formatting of JSON, JavaScript/TypeScript,
  HTML, CSS and XML;
- with the Diacritics plugin: adding accents to letters and removing them.

Every change can be undone with Ctrl+Z.

## Transcribing computer audio

Assign **Listen to computer audio** in **Settings → Hotkeys**, or switch from
the voice-input overlay with **Alt+L**. Choose all computer sound or a playing
application. A source chosen in the overlay lasts for that listening session;
the next hotkey activation uses the source saved in settings.

The overlay remains visible when you click into a player. Press the listening
hotkey again, **Enter** while the overlay has focus, or **Stop** to finish.
The transcript opens an action menu for copying, insertion, the editor, chat or
AI actions. It is not inserted automatically. **Reply by voice** uses the heard
message as context for correction; an AI request selected from the dictated
result also receives that message as context. **Alt+L** switches modes. If a
recording already contains text, the switch first shows its result.

If an application closes, listening waits for it to return. It does not start
recording other applications automatically. You can choose **Record all sound**
manually. Listening stops after three minutes without recognized speech or one
hour overall. Speech connections are renewed when required while capture and
the recognized text are preserved.

With cloud recognition (Deepgram or Gemini), captured sound, including other
people's speech, goes to the selected provider. Sherpa sends sound to the server
you configured: it stays on this computer only when that server is local.
The information icon in the listening overlay explains this. Audio is not saved
to disk; the final transcript follows your history settings.

Linux listening requires PipeWire. Windows offers application capture when its
process-loopback API is available and otherwise offers all-sound capture.
The move handle is available on regular overlay windows; layer-shell overlays
cannot be dragged. Developer details are in [Architecture](../dev_docs/architecture.md).
