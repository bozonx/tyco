# Moving and synchronizing your data

TyCo keeps settings, commands, installed plugins, editor history, chats and the
main AI workspace in one user data folder. Open **Settings → Data folder** to see
its current location. Keep a backup before changing locations or recovering a
conflict; synchronization also distributes accidental deletions.

TyCo does not work with any synchronization program itself: it has no
integration with Syncthing, OneDrive, Git or others and no settings for them.
It only keeps its data as plain files, laid out so that most programs sync
them well: a file per profile, project and chat, a journal per device, and
nothing but data in the synchronized folders. The advice below is how to apply
the general rules in a few common programs.

## Ways to set it up

1. **Nothing set up.** One data folder in the standard place, with the main
   workspace inside. Nothing is synchronized.
2. **Everything synchronized.** Choose the data folder inside a synchronized
   directory. The path may differ between computers: each computer keeps its
   own.
3. **Personal and work.** Personal profiles live in the main workspace, inside
   the data folder. Work profiles live in an attached workspace, a folder
   synchronized on its own and attached only on the computers that need it.
4. **A project with code.** An external project: its description lives in the
   workspace, its folder is set on each computer, or not set ("not connected
   on this device"). The type of a project is chosen when it is created. To
   change it later, use "Make external…" or "Make internal…" next to the
   project folder in its settings. Making a project external moves its files
   to the folder you choose. Making it internal copies the files of its
   folder into the workspace, or moves them and sends the folder to the
   trash; nothing is deleted before everything is copied. "Change…" only
   points an external project to another folder on this computer: its files
   are not moved. **Disconnect** in the menu of an external project removes
   it from TyCo and leaves its folder untouched; **Delete** an internal
   project deletes its files with it.

Call recordings of the dialog are kept per dialog in
`dialogs/recordings/<dialog-id>/` of the data folder (see `docs/dialog.md`).
They are the largest files TyCo keeps; to leave them out of a synchronization,
exclude that folder in your synchronization program, e.g. `/dialogs/recordings`
in Syncthing's `.stignore`, or keep it on another disk (see below).

## General rules

- Synchronize the whole folder, including its marker (`tyco-user.json` for the
  data folder, `tyco-vault.json` for a workspace).
- Wait for the initial transfer to finish before connecting another computer.
- Do not synchronize TyCo's device, state or cache directories. They contain
  the identity of this device, local keys, recovery copies and derived indexes.
- Files named `.tyco-tmp-*` live for a fraction of a second while a file is
  written; you may exclude them.
- Keep conflict copies: TyCo leaves files it does not recognize alone and
  never reads or deletes them.

For Syncthing, configure the directory as a shared folder on both devices and
add `.tyco-tmp-*` to its ignore patterns (the `.stignore` file) on both.

For OneDrive, place the folder inside your OneDrive directory and select
**Always keep on this device** for it on each computer: reading settings and
chats may otherwise download cloud-only files. Do not exclude actual chats,
images or the markers.

To keep profiles in Git, keep them in an attached workspace outside the data
folder and do not synchronize the same folder with a second program.

## First computer

1. On the first launch, choose **Start fresh** to create your data folder in the
   standard location (or **Select folder** if you already have a synchronized
   TyCo folder).
2. To move the folder into a synchronized directory later, choose a folder
   controlled by you. TyCo trusts its commands, scripts and plugins, including
   changes delivered from other computers. Chat and history files may contain
   private text. TyCo warns when other users of the computer may write to the
   folder (Linux).
3. Click **Change** in **Settings → Data folder**, keep **Move current folder**
   checked, click **Select new location…** and choose an empty location, such as
   a `TyCo` subfolder in your synchronized directory (if the folder is on
   another drive, TyCo asks for confirmation before moving the files; if
   **Move current folder** is unchecked, TyCo creates a new folder there and
   leaves your previous data untouched). TyCo moves its data, the main
   workspace with it, and restarts. If a folder already contains TyCo data and
   its marker, TyCo connects to it and leaves your previous data where it was;
   it does not merge two collections.
4. Synchronize the folder and wait for the initial transfer.

## Second computer

Wait until the folder is fully available, then choose **Select folder** on the
first launch (or **Change → Select new location…** in **Settings → Data
folder**) and choose the synchronized folder. A folder without its marker is
refused, even when some data files have arrived. A layout made by a newer TyCo
version requires updating TyCo; a previously configured folder of that layout is
opened for reading only.

Set up the values that belong to this computer:

- API keys and secret webhook headers, stored in this computer's secret store;
- command variables, such as local server URLs and directory paths;
- FastNote folders, global hotkeys and other device settings;
- the attached workspaces and the folders of external projects.

Commands for another operating system remain saved but cannot run here. Device
values never replace their shared declarations or secret identifiers. Keep the
clocks of your devices synchronized: editor history uses their timestamps for
ordering and for the cutoff of an explicit history clear.

## Workspaces

A workspace is a folder of AI profiles, projects, their chats, memory and
files. The main workspace is always inside the data folder and moves with it.
**Settings → AI profiles** shows one tab per workspace once there is more than
one: its profiles, its projects, its chat history and the workspace itself.
Whatever you create there goes into that workspace.

Attach other workspaces with **Attach workspace…**:

- a folder that holds a workspace is attached as it is;
- an empty folder gets a new workspace; you give it a name, the same on every
  computer;
- a folder of other files gets a `TyCo Workspace` subfolder, if you agree.

Which workspaces are attached is decided on each computer. **Remove from
list** removes a workspace from this computer only; its files stay where they
are.

A workspace that is not there, such as a disk that is not mounted, shows as
"not connected on this device", with **Choose folder…** and **Remove from
list**. Nothing is created in its place. Its profiles disappear from menus and
grids without leaving gaps, and come back to their places when the workspace
does.

A workspace created by a newer TyCo version requires updating TyCo before
opening it; its files are left untouched.

A copy of a workspace that is attached already, including a copy of the main
`ai-vault` folder, cannot be attached: attach the original folder instead.

Workspaces are kept apart: a profile works only with the projects and files of
its own workspace. A project belongs to one workspace; to work on the same code
folder from two workspaces, add it to each as an external project. This is not
a sandbox, though: commands, scripts and plugins are the same for all profiles
and are limited only by their own permissions. TyCo warns when other users of
the computer may write to a workspace (Linux): its profiles run the commands of
this computer.

### Chat history of a workspace

Each workspace decides whether the chats of its profiles are saved and how long
they are kept. The setting is stored in the workspace folder, so it applies on
every computer that syncs it. A workspace that sets nothing follows the default
in **Settings → History**.

### Moving to another workspace

**Move to workspace…** in the menu of a profile or a project moves it to
another connected workspace:

- a profile moves with its instructions, memory, files and chats, and loses
  access to the projects it leaves behind; the grid and prompts that name it
  follow it;
- a project moves with its description and, if it is internal, its files; the
  profiles left behind lose access to it. An external project keeps its folder
  on this computer; set it again on the others.

The copy is made first and the original removed only then. On a computer where
the target workspace is not attached, the moved profile or project disappears
until it is.

## Chats, files and projects

A profile keeps files in three places:

- **Chat**: what you attach to a message and the images in it. These files
  belong to their chat and are deleted with it, by history retention too. The
  AI's answers are text in the chat, not files.
- **Files**: the profile's own folder,
  `profiles/<profile-id>/workspace/` in its workspace. When you ask the AI to
  save, keep, download or create a file without naming a place, it goes here:
  Markdown notes, code, tables and any other text. The files outlive the chat
  and are available in every chat of the profile. The AI manages this folder;
  open it in your file manager when you need a file. A chat attachment can be
  copied here with its **Copy to the profile files** button.
- **Project**: your own work. The AI changes it only for a task about that
  project and within the profile's permissions.

In a chat, every file action of the AI is marked with where it happened: the
chat file, the profile files or the project's name.

## Folders on another disk

TyCo has no settings for where its parts go: replace a folder with a link to
a folder elsewhere, e.g. to keep the recordings on a larger disk. TyCo writes
through these links and never replaces or removes them:

- the data folder itself, and every attached workspace;
- inside the data folder: `history`, `dialogs`, `dialogs/recordings`, `chats`,
  `chats/images`, `chats/attachments`, `ai-vault` and `plugins`.

On Linux use a symbolic link with an absolute target
(`ln -s /mnt/big/tyco-recordings ~/.local/share/com.tyco.app/dialogs/recordings`).
On Windows use a junction (`mklink /J <folder> <target>`), which needs no
administrator rights, or a symbolic link. Quit TyCo, move the folder's
contents to the target, and put the link in its place. Links anywhere else
in the data folder are not followed.

Inside a project or the files of a profile, a link that leads elsewhere in
that same project works: the AI reads and writes through it, and moving or
converting the project keeps it as a link. A link that leads out of the
project, or nowhere, does not: the AI does not see it, and moving or
converting the project is refused until you move or delete it. To give the AI
another folder, add it as another external project.

A link whose target is not there, such as a disk that is not mounted, is
not replaced by a new folder: what would go there waits, e.g. a finished
recording stays on this computer until the next start finds the target.
Moving the data folder moves the link, not its target. Synchronization
programs treat links differently: Syncthing sends the link itself, not what
it leads to, and OneDrive does not follow them, so the linked folder is then
synchronized on its own or not at all.

## Folders inside folders

The data folder and the attached workspaces never lie inside one another: TyCo
refuses such a choice when you move the data folder or attach a workspace.

The folder of an external project lies outside the data folder and every
workspace and holds none of them: the AI of a profile working in it could
otherwise reach the memory and chats of other profiles, or the commands TyCo
runs. TyCo refuses such a folder; a project that has one from an earlier
version is shown as not available until you choose another folder.

## Missing folders and conflicts

If a disk or synchronized folder disappears, TyCo stops writing there. It does
not create a replacement collection at that path. Reconnect the disk, wait for
the marker and data, and use **Retry** to restart. **Use default folder** uses
whatever is already in the standard location, or creates a new collection
there; it does not recover or copy the missing folder's data.

Settings changes already delivered by another computer are merged when you
save. Before saving a profile, its `SOUL.md` or a project, TyCo checks whether its
file changed since the version you edited. If it did, TyCo tells you and offers
**Reload** or **Save mine**. A page without unsaved changes picks up such a
change by itself. Chats have no such check: avoid editing the same chat on two
computers at once. An idle, saved open chat refreshes automatically; an
actively edited chat is preserved. Fully simultaneous writes by another program
or computer can still produce synchronization conflicts: the check does not lock
other programs or devices.

If your synchronization program reports a conflict, stop TyCo on the affected
computers and back up the entire folder, including all conflict copies. Compare
the original and conflicting files and choose the intended version. Keep the
copies until recovery is verified. Do not simply rename a copied chat into a
new chat filename: its embedded id must match the filename. Restart TyCo after
manual recovery. Recovery copies from settings repairs and merges are stored
in the local state directory's `recovery` folder; they are not synchronized.
