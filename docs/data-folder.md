# Moving and synchronizing your data

TyCo keeps settings, commands, installed plugins, editor history, chats and the
built-in AI vault in one user data folder. Open **Settings → Data folder** to see
its current location. Keep a backup before changing locations or recovering a
conflict; synchronization also distributes accidental deletions.

## First computer

1. Choose a folder controlled by you. TyCo trusts its commands, scripts and
   plugins, including changes delivered from other computers. Chat and history
   files may contain private text.
2. Use **Move to folder** and select an empty location, such as a `TyCo`
   subfolder in your synchronized directory. TyCo moves its data and restarts.
   Use **Connect existing folder** only for a folder that already contains TyCo
   data and its `tyco-user.json` marker. Connecting leaves your previous data
   where it was; it does not merge two collections.
3. Synchronize the whole folder, including its marker, and wait for the initial
   transfer to finish before connecting another computer.

For Syncthing, configure this directory as a shared folder on both devices. Add
`.tyco-tmp-*` to its ignore patterns (the `.stignore` file) to skip temporary
atomic writes. Apply the exclusion on both devices. Keep conflict copies:
TyCo currently excludes them from normal lists and does not resolve them.

For OneDrive, place the folder inside your OneDrive directory and select
**Always keep on this device** for it on each computer. Reading settings and
chat indexes may download cloud-only files; offline availability requires
keeping the data locally. Exclude `.tyco-tmp-*` if your synchronization tool
supports ignore patterns. Do not exclude actual chats, images or the marker.

Do not synchronize TyCo's device, state or cache directories. They contain the
identity of this device, local keys, recovery copies and derived indexes. If you
keep your AI vault in Git, use an external vault outside the synchronized user
data folder; do not synchronize Git's internal files through a second tool.

## Second computer

Wait until the folder is fully available, then choose **Connect existing
folder**. A folder without its marker is refused, even when some data files
have arrived. A layout made by a newer TyCo version requires updating TyCo;
a previously configured folder of that layout is opened for reading only.

Set up the values that belong to this computer:

- API keys and secret webhook headers, stored in this computer's secret store;
- command variables, such as local server URLs and directory paths;
- FastNote folders, global hotkeys and other device settings;
- an external AI vault location, if used, and paths for external projects.

Commands for another operating system remain saved but cannot run here. Device
values never replace their shared declarations or secret identifiers. Keep the
clocks of your devices synchronized: editor history uses their timestamps for
ordering and for the cutoff of an explicit history clear.

## Missing folders and conflicts

If a disk or synchronized folder disappears, TyCo stops writing there. It does
not create a replacement collection at that path. Reconnect the disk, wait for
the marker and data, and use **Retry** to restart. **Use default folder** uses
whatever is already in the standard location, or creates a new collection
there; it does not recover or copy the missing folder's data.

Settings changes already delivered by another computer are merged when you
save. Simultaneous writes to the same revision can still produce synchronizer
conflicts. Until automatic conflict resolution is available, avoid editing the
same settings, chat or profile simultaneously on different computers. An idle,
saved open chat refreshes automatically; an actively edited chat is preserved.

If your synchronization tool reports a conflict, stop TyCo on the affected
computers and back up the entire folder, including all conflict copies. Compare
the original and conflicting files and choose the intended version. Keep the
copies until recovery is verified. Do not simply rename a copied chat into a
new chat filename: its embedded id must match the filename. Restart TyCo after
manual recovery. Recovery copies from settings repairs and merges are stored
in the local state directory's `recovery` folder; they are not synchronized.
