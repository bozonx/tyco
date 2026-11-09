# Moving and synchronizing your data

TyCo keeps settings, commands, installed plugins, editor history, chats and the
main AI vault in one user data folder. Open **Settings → Data folder** to see
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
   vault inside. Nothing is synchronized.
2. **Everything synchronized.** Choose the data folder inside a synchronized
   directory. The path may differ between computers: each computer keeps its
   own.
3. **Personal and work.** Personal profiles live in the main vault, inside the
   data folder. Work profiles live in an attached vault, a folder synchronized
   on its own and attached only on the computers that need it.
4. **A project with code.** An external project: its description lives in the
   vault, its folder is set on each computer, or not set ("not connected on
   this device").

## General rules

- Synchronize the whole folder, including its marker (`tyco-user.json` for the
  data folder, `tyco-vault.json` for a vault).
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

To keep profiles in Git, keep them in an attached vault outside the data
folder and do not synchronize the same folder with a second program.

## First computer

1. Choose a folder controlled by you. TyCo trusts its commands, scripts and
   plugins, including changes delivered from other computers. Chat and history
   files may contain private text. TyCo warns when other users of the computer
   may write to the folder (Linux).
2. Use **Move to folder** and select an empty location, such as a `TyCo`
   subfolder in your synchronized directory. TyCo moves its data, the main vault
   with it, and restarts. Use **Connect existing folder** only for a folder that
   already contains TyCo data and its marker. Connecting leaves your previous
   data where it was; it does not merge two collections.
3. Synchronize the folder and wait for the initial transfer.

## Second computer

Wait until the folder is fully available, then choose **Connect existing
folder**. A folder without its marker is refused, even when some data files
have arrived. A layout made by a newer TyCo version requires updating TyCo;
a previously configured folder of that layout is opened for reading only.

Set up the values that belong to this computer:

- API keys and secret webhook headers, stored in this computer's secret store;
- command variables, such as local server URLs and directory paths;
- FastNote folders, global hotkeys and other device settings;
- the attached vaults and the folders of external projects.

Commands for another operating system remain saved but cannot run here. Device
values never replace their shared declarations or secret identifiers. Keep the
clocks of your devices synchronized: editor history uses their timestamps for
ordering and for the cutoff of an explicit history clear.

## Attached vaults

A vault is a folder of AI profiles, projects, their chats and memory. The main
vault is always inside the data folder and moves with it. Attach other vaults
in **Settings → AI profiles → AI vaults → Attach vault…**:

- a folder that holds a vault is attached as it is;
- an empty folder gets a new vault; you give it a name, the same on every
  computer;
- a folder of other files gets a `TyCo Vault` subfolder, if you agree.

Which vaults are attached is decided on each computer. **Remove from list**
removes a vault from this computer only; its files stay where they are.

A vault that is not there, such as a disk that is not mounted, shows as "not
connected on this device", with **Choose folder…** and **Remove from list**.
Nothing is created in its place. Its profiles disappear from menus and grids
without leaving gaps, and come back to their places when the vault does.

A copy of a vault that is attached already, including a copy of the main
`ai-vault` folder, cannot be attached: attach the original folder instead.

Vaults are kept apart: a profile works only with the projects and files of its
own vault. This is not a sandbox, though: commands, scripts and plugins are the
same for all profiles and are limited only by their own permissions. TyCo warns
when other users of the computer may write to a vault (Linux): its profiles run
the commands of this computer.

When creating a profile or a project, choose the vault it goes to. Two profiles
of one name in different vaults are shown with the name of their vault.

## Folders inside folders

The data folder and the attached vaults never lie inside one another: TyCo
refuses such a choice when you move the data folder or attach a vault.

An external project may lie inside the data folder or a vault; its files are
then synchronized with that folder. TyCo warns about it in the project; choose
a folder outside if that is not what you want.

## Missing folders and conflicts

If a disk or synchronized folder disappears, TyCo stops writing there. It does
not create a replacement collection at that path. Reconnect the disk, wait for
the marker and data, and use **Retry** to restart. **Use default folder** uses
whatever is already in the standard location, or creates a new collection
there; it does not recover or copy the missing folder's data.

Settings changes already delivered by another computer are merged when you
save. A profile, its `SOUL.md` and a project are never saved over a change made
on another computer or outside TyCo meanwhile: TyCo tells you and offers
**Reload** or **Save mine**. A page without unsaved changes picks up such a
change by itself. Chats have no such check: avoid editing the same chat on two
computers at once. An idle, saved open chat refreshes automatically; an
actively edited chat is preserved.

If your synchronization program reports a conflict, stop TyCo on the affected
computers and back up the entire folder, including all conflict copies. Compare
the original and conflicting files and choose the intended version. Keep the
copies until recovery is verified. Do not simply rename a copied chat into a
new chat filename: its embedded id must match the filename. Restart TyCo after
manual recovery. Recovery copies from settings repairs and merges are stored
in the local state directory's `recovery` folder; they are not synchronized.

## Old devices

Every computer keeps its own editor history journal in the data folder. The
journal of a computer you no longer use stays until you remove it: **Settings →
Data folder → Advanced** lists the journals with their number of entries and
last write, and **Delete device history** removes the journal of another
device everywhere the folder is synchronized.
