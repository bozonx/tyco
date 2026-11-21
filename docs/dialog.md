# Dialog: a call transcript with live translation

The **Dialog** tab of the main window listens to a call in any application
(Zoom, Google Meet, Microsoft Teams and others) and shows it as a feed of
turns: the other side on the left, you on the right. What the other side says
is translated as it comes.

## Starting and stopping

Press **Start** during the call. The dialog keeps going when you switch tabs,
hide or minimize the window, until you press **Stop** or quit TyCo.

Every start begins a new conversation: the previous transcript leaves the
feed. With the history turned on it is kept there (see
[History](#history)); with the history off it is gone.

While the dialog runs it holds the sound: voice input, voice commands and
listening do not record and say that the sound is busy with the dialog.

## Source

Pick it in the toolbar before you start; TyCo remembers the last choice.

- **Microphone and computer**: your speech and the other side are recorded
  apart and shown as bubbles on both sides.
- **Computer only**: only the other side, shown as paragraphs.

Hover over a bubble to see who spoke and when.

With speakers instead of headphones TyCo mutes the echo of the call in your
microphone, so the other side is not transcribed twice. Headphones still give
the cleanest result.

## Translation

Pick the language to translate into in the toolbar; without one only the
original is shown. The toolbar also switches between the translation, the
original and both (the translation large, the original small under it), and
remembers both choices. While a phrase is being translated, its original
words stay dimmed in place of the translation. Your own speech is not
translated, but it helps to translate what the other side answers to. A
phrase that could not be translated offers **Try again**.

The translation service is the one of the translation settings unless
**Settings → Dialog** names another. An AI model translates with the context
of the conversation; DeepL and Google answer faster but see each phrase
alone.

## Subtitles

**Subtitles** shows the latest words of the other side in a narrow strip over
all windows and minimizes the main window. **Expand** closes the strip and
brings the main window back; **Stop** ends the dialog and brings it back too.

On Linux desktops that support it (KDE Plasma, Sway, Hyprland and others on
Wayland), the strip stays at the bottom of the screen and clicks pass through
it to the call, except on its buttons. Elsewhere, drag it to move it and drag
its lower right corner to resize it; TyCo remembers where it was.

## Exporting the transcript

The **⋯** menu of the toolbar holds the transcript. **Copy the transcript**
puts it on the clipboard with who said what and when; **Send to the action
menu** opens the action menu with the transcript as the selected text, e.g.
to summarize it with a transformation:

```
[14:03:12] Other side: Can we move the release to next week?
           Translation: Мы можем сдвинуть релиз на следующую неделю?
[14:03:18] Me: Да, если успеем с тестами
```

## History

With the history turned on (**Settings → History**), each conversation from
**Start** to **Stop** becomes one entry of the **History** tab, in the format
above. It is saved every few seconds while the conversation goes on, and when
you stop, hide the window or quit TyCo, so a crash loses little. Words still
being recognized are not saved. A conversation in which nothing was
recognized leaves no entry. The entry is kept as long as other history
entries and is deleted the same way.

## Recording the call

The arrow next to **Start** offers **Start recording**: the conversation is
transcribed as usual and its sound is also saved to a file. **Start** itself
never records. The first time, TyCo reminds you to tell the other person
before you record a conversation with them; **Got it** starts the recording,
**Cancel** starts nothing.

While recording, the toolbar and the subtitles show a red dot with the time
recorded. The file is an Opus audio file (`.opus`) that any modern player
opens: with the microphone, your voice is the left channel and the other side
the right one, as heard before the echo of the speakers is muted; without the
microphone it is the computer sound alone. The file is written as the call
goes, so after a crash it plays up to the last second or so.

Recordings go to `TyCo` in your Music folder unless **Settings → Dialog →
Recordings folder** names another one on this computer; changing the folder
does not move the recordings made before. A file is named by the time it
started, e.g. `TyCo dialog 2026-11-20 14-03-05.opus`. The history entry of a
recorded conversation shows the file name and **Show in folder**, or "file
not found" once the file was moved or deleted. Deleting the history entry
leaves the file where it is. If the file cannot be written (the disk is
full, the folder is gone), the recording stops and the transcript goes on.

Recordings are not part of the TyCo data folder and are not synchronized with
it. Calls started from the command line or D-Bus are never recorded.

Speech recognition uses the provider of the transcription settings; see
`dev_docs/architecture.md` for how the sound is captured and recorded.
