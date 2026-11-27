# What TyCo can and cannot do

TyCo helps you work with text and other kinds of input. Its profiles are
personal assistants, each with its own field — a marketer, a DevOps helper, a
business advisor, a therapist — its own memory, its own folder and the projects
you connect to it. A profile can work with code, but TyCo is not a coding
agent.

The rule behind every tool is **predictability**: an assistant can do exactly
what you set up, and nothing more. It never decides on its own to reach
something new.

## What an assistant sees out of the box

- Its own `workspace/` folder and its memory. Reading the workspace and creating new files there are automatic. Overwriting, editing, moving and deleting existing files ask first. What
  it changes in memory is shown in the steps of the answer. Once the chat has
  read a web page or the output of a command or plugin, a change to the memory
  asks first: the memory shapes every chat to come, and the text it read could
  try to plant instructions there.
- The projects you connected to the profile, each with its own permission:

  | Level          | Read | Write | Delete |
  | -------------- | ---- | ----- | ------ |
  | Read only      | yes  | no    | no     |
  | Read and write | yes  | asks  | asks   |
  | Full           | yes  | yes   | asks   |

  At the full level you can also tick **Delete without asking**. Moving a file
  out of a folder counts as deleting it there.

- The files and screenshots you attach to the conversation.
- The web (search and reading pages), unless you turn it off in the profile.

Nothing else. To give an assistant a folder on your computer, connect it to the
profile as an external project; there is no other way.

## What plugins and commands add

A plugin or a command you wrote can do more than the built-in tools — a script
may touch any file you can. That is your choice: you install the plugin, grant
its capabilities and write the command. TyCo shows where each tool comes from
and what the plugin may do, and by default asks before such a tool runs. Commands
and plugin tools are picked per profile in its settings.

## What TyCo never does

- No computer use: no screenshots taken by the assistant, no reading of your
  clipboard or selection, no control of windows, mouse or keyboard. Data gets
  to the assistant only when you give it: by pasting, attaching, taking a
  screenshot yourself or with a hotkey.
- No tool changes settings, permissions, the list of tools, profiles, projects
  or commands. Nothing an assistant reads — a web page, a file, a tool's output
  — can raise its permissions.
- No "never ask" mode.

## Where tools are available

| Where          | Tools                                                      | Asks?                                                 |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| Ask AI         | the web (switch in Settings → Ask AI), your attachments    | asks about new destinations after reading attachments |
| AI command     | only what you put on its list: commands, web, plugin tools | the whitelist grants by default                       |
| A profile chat | as set in the profile                                      | by each tool's setting                                |

"Ask AI" is meant for quick answers and checking facts: pick a fast model for
it. It never sees your files, memory or commands. An AI command often runs with
no window to ask in. Its whitelist grants access by default, and it has no
files or memory. A [quiet external run](external-control.md#quiet-runs-and-scheduling)
fails if it needs tool confirmation.

## When an assistant asks

When a call needs your approval, the message shows where the tool comes from,
what it may do, and for a plugin its capabilities. You can allow it once, allow
it in this chat (kept when you open the chat from the history again; a new chat
starts without), always allow it in this profile, or deny it. When the model
asks for several calls at once, you can allow or deny them together. The chat header lets you revoke permissions remembered for the chat.

**Protection from leaks.** Once a profile chat has read your data — files,
memory or attachments — an assistant asks before reading a web page nobody
named in the conversation or in search results, before sending a web search to Jina, and before any tool that acts
outside TyCo, even if it is allowed. It can remember a site or tool for the chat when you choose to allow it in this chat. A one-time approval covers the current call.

Since memory is on in most profiles, this means a tool that acts outside TyCo
asks once in every new chat, even when it is set to "Allow".

Accepted limits:

- The text of a web search query is not checked.
- An AI command can access its whitelisted tools, including the web. A chat
  that calls an AI command with the web on its list asks as for a tool that
  acts outside.

Settings → **Tools** lists every source of tools, what each tool may do and its
default; there you can turn a plugin off for every profile and AI command.
