# Dialog: a call transcript with live translation

The **Dialog** tab of the main window listens to a call in any application
(Zoom, Google Meet, Microsoft Teams and others) and shows it as a feed of
turns: the other side on the left, you on the right. What the other side says
is translated as it comes.

## Starting and stopping

Press **Start** during the call. The dialog keeps going when you switch tabs,
hide or minimize the window, until you press **Stop** or quit TyCo.

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

**Collapse to subtitles** turns the window into a narrow strip over all
windows with the latest words of the other side. Drag it to move it, drag its
lower right corner to resize it; TyCo remembers where it was. **Expand** gives
the window its size and place back; **Stop** ends the dialog and expands the
window too.

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

Nothing of the call is saved: the transcript lives until you clear it (TyCo
asks first) or quit TyCo. Stopping and starting again adds to the same
transcript. Speech recognition uses the provider of the transcription settings; see
`dev_docs/architecture.md` for how the sound is captured.
