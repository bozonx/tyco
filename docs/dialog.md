# Dialog: a call transcript with live translation

The **Dialog** tab of the main window listens to a call in any application
(Zoom, Google Meet, Microsoft Teams and others) and shows it as a feed of
turns: the other side on the left, you on the right. What the other side says
is translated as it comes.

If you only use TyCo for typing, turn **Dialog mode** off in
**Settings → Dialog**: the tab goes away, and a running dialog stops with its
transcript saved.

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

- **Call**: your microphone and the other side are recorded apart and shown
  as bubbles on both sides. Use it for Zoom, Meet, Teams and other calls.
- **Computer sound**: only what the computer plays, such as a video, a webinar
  or a podcast, shown as paragraphs.

Hover over a bubble to see who spoke and when.

With speakers instead of headphones TyCo turns down the echo of the call in your
microphone, so the other side is not transcribed twice. Headphones still give
the cleanest result.

## Translation

The languages button in the toolbar shows the route, such as
**English → Russian**, and opens the language settings:

- **The other side speaks**: needed only with Deepgram, which is told the
  language; **Auto** lets it detect the language.
- **Translate into**: without a language only the original is shown.
- **You speak**: the language your own speech is recognized in; by default
  the one of the dictation.

The toolbar also switches between the translation, the original and both (the
translation large, the original small under it); pick the view before you start
if you like, and TyCo remembers it. When the toolbar is narrow, the view is in
its **⋮** menu. While a phrase is being translated, its original words stay
dimmed in place of the translation. Your own speech is not translated, but it
helps to translate what the other side answers to. A phrase that could not be
translated offers **Try again**.

An AI model translates the dialog: it sees the phrases said before, so short
pieces of speech come out right, and it follows the glossary of the translation
settings. Pick the model under **Settings → LLM → Dialog translation** or
**Settings → Dialog**, where you can also add your own instructions, such as
a conversational tone. A fast model keeps up better. Without a model the
languages button shows a warning and nothing is translated.

## Subtitles

The compact mode button (picture in picture) shows the latest words of the other side in a narrow strip over
all windows and minimizes the main window. **Start in compact mode** in the
menu of **Start** does both at once. **Expand** closes the strip and
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
recognized leaves no entry, unless it was recorded: then the entry is there
from the start, so the recording can always be found. The entry is kept as long as other history
entries and is deleted the same way, together with its recording.

## Recording the call

The arrow next to **Start** offers **Start recording**: the conversation is
transcribed as usual and its sound is also saved to a file. **Start** itself
never records. The first time, TyCo reminds you to tell the other person
before you record a conversation with them; **Got it** starts the recording,
**Cancel** starts nothing. Recording is offered only while the history is
saved to disk (**Settings → History**): a recording belongs to its history
entry.

While recording, the toolbar and the subtitles show a red dot with the time
recorded. The file is an Opus audio file (`.opus`) that any modern player
opens. Without the microphone it holds the computer sound alone. With the
microphone, two settings in **Settings → Dialog** decide how it sounds:

- **One channel for both sides** (on by default): your voice and the other
  side are in one channel, so both are heard in both ears. Off, your voice
  is the left channel and the other side the right one.
- **Record what the speech recognition hears** (on by default): the echo of
  the speakers in your microphone is lowered, and loud peaks are limited.
  When TyCo takes your voice for that echo, it is quiet in the recording
  too. Off, the sound is kept as captured, echo included: with speakers
  instead of headphones the other side is then heard twice, a little apart.

Either way the sound is recorded at the quality speech recognition uses,
which is enough for voices but not for music. The settings apply to the
next recording. The file is written as the call
goes, so after a crash it plays up to the last second or so.

Recordings are kept with the history, in `history/recordings` of the TyCo
data folder; **Settings → Dialog → Call recordings → Open folder** opens it.
A file is named by the time it started and a short code, e.g.
`2026-11-20 14-03-05 a1b2c3.opus`; do not rename it, or its history entry
loses it. The history entry of a recorded conversation shows the file name
and **Show in folder**, or "file not found" when the file is not there, e.g.
not synchronized yet. The play button next to it opens a player right in the
entry; one recording plays at a time, and none while TyCo records sound (a
dialog, listening or voice input), so that it does not go into what is
recorded. A recording still being written
plays once the conversation stops. A recording goes with its history entry: when you
delete the entry (after the few seconds in which **Undo** brings both back),
clear the history, or when the history settings no longer keep the entry. If
the disk falls behind for a moment, the
missed sound is replaced by silence of the same length, so the file keeps
the time of the call. If the disk stays behind for more than a minute or the
file cannot be written, the recording stops, the transcript goes on, and
the history entry marks the recording as incomplete. A conversation stopped
before it started leaves no file. A recording deleted with its
entry while the call still goes on is removed as soon as the call stops.

If the history cannot keep the entry (it could not be saved, or the history
is no longer saved to disk), TyCo says so: a recording no entry names is
deleted after 7 days, so move the file out of `history/recordings` to keep
it. The data folder cannot be moved while a dialog runs; moving it from the
settings stops the dialog first.

Recordings move and synchronize with the data folder. To keep them on another
disk, or out of a synchronization, see `docs/data-folder.md`. Calls started
from the command line or D-Bus are never recorded.

Speech recognition uses the provider of the transcription settings; see
`dev_docs/architecture.md` for how the sound is captured and recorded.
