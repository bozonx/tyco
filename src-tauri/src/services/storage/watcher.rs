//! Content-based storage revisions and external change detection. Native events
//! are hints: periodic scans also cover network mounts and lost notifications.
use std::collections::{BTreeMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::user_data::UserData;
use super::user_files::{conflict_original, is_temporary_name};
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::background::BackgroundServices;
use crate::state::AppState;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StorageEvent {
    EntityChanged { path: PathBuf, hash: String },
    EntityDeleted { path: PathBuf },
}

#[derive(Default)]
struct Bus {
    roots: Vec<PathBuf>,
    own: BTreeMap<PathBuf, Option<String>>,
    subscribers: Vec<tokio::sync::broadcast::Sender<StorageEvent>>,
}
static BUS: OnceLock<Mutex<Bus>> = OnceLock::new();
fn bus() -> &'static Mutex<Bus> {
    BUS.get_or_init(Mutex::default)
}

pub fn content_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Only registered data roots enter the bus; device secrets never do.
pub fn written(path: &Path, bytes: &[u8]) {
    publish(StorageEvent::EntityChanged {
        path: path.to_owned(),
        hash: content_hash(bytes),
    });
}
/// Captures entity removals before deleting a profile or a project tree.
pub fn remove_tree(path: &Path) -> Result<(), AppError> {
    super::user_data::ensure_write_allowed(path)?;
    let mut files = Snapshot::new();
    scan_with(path, &mut files, |_| Ok(String::new()))?;
    std::fs::remove_dir_all(path)?;
    for path in files.keys() {
        deleted(path);
    }
    Ok(())
}

pub fn deleted(path: &Path) {
    publish(StorageEvent::EntityDeleted {
        path: path.to_owned(),
    });
}
fn publish(event: StorageEvent) {
    let (path, hash) = match &event {
        StorageEvent::EntityChanged { path, hash } => (path, Some(hash.clone())),
        StorageEvent::EntityDeleted { path } => (path, None),
    };
    if path
        .components()
        .any(|part| is_temporary_name(&part.as_os_str().to_string_lossy()))
    {
        return;
    }
    let mut bus = bus().locked();
    if !bus.roots.iter().any(|root| path.starts_with(root)) {
        return;
    }
    let fingerprint = if hash.is_some() && is_image(path) {
        storage_fingerprint(path).ok().or(hash)
    } else {
        hash
    };
    bus.own.insert(path.clone(), fingerprint);
    bus.subscribers.retain(|sender| sender.receiver_count() > 0);
    for sender in &bus.subscribers {
        let _ = sender.send(event.clone());
    }
}
pub fn subscribe() -> tokio::sync::broadcast::Receiver<StorageEvent> {
    let (sender, receiver) = tokio::sync::broadcast::channel(256);
    bus().locked().subscribers.push(sender);
    receiver
}

#[derive(Default)]
pub struct StorageWatcher {
    check: Mutex<Option<mpsc::SyncSender<()>>>,
}
pub fn check_now(app: &AppHandle) {
    if let Some(watcher) = app.try_state::<StorageWatcher>() {
        if let Some(sender) = watcher.check.locked().as_ref() {
            let _ = sender.try_send(());
        }
    }
}

type Snapshot = BTreeMap<PathBuf, String>;
fn scan(root: &Path, files: &mut Snapshot) -> std::io::Result<()> {
    scan_storage(root, files, &Snapshot::new())
}

fn scan_storage(root: &Path, files: &mut Snapshot, previous: &Snapshot) -> std::io::Result<()> {
    scan_tree(root, root, files, previous, storage_fingerprint, true)
}

fn scan_with(
    root: &Path,
    files: &mut Snapshot,
    fingerprint: fn(&Path) -> std::io::Result<String>,
) -> std::io::Result<()> {
    scan_tree(root, root, files, &Snapshot::new(), fingerprint, false)
}

fn is_storage_entry(relative: &Path) -> bool {
    let mut parts = relative.iter();
    let Some(first) = parts.next().and_then(|name| name.to_str()) else {
        return false;
    };
    match first {
        "config.json" | "tyco-user.json" | "tyco-vault.json" => parts.next().is_none(),
        "history" => parts.next().is_none_or(|name| name == "editor"),
        "chats" | "plugins" | "profiles" => true,
        // The files of an internal project are the user's, read on demand:
        // only its description is data of the app.
        "projects" => match (parts.next(), parts.next(), parts.next()) {
            (None, _, _) | (Some(_), None, _) => true,
            (Some(_), Some(file), None) => file == "project.json",
            _ => false,
        },
        "ai-vault" => {
            let rest: PathBuf = parts.collect();
            rest.as_os_str().is_empty() || is_storage_entry(&rest)
        }
        _ => false,
    }
}

fn retain_unreadable(
    path: &Path,
    files: &mut Snapshot,
    previous: &Snapshot,
    error: &std::io::Error,
) {
    log::warn!(
        "Could not scan {}: {error}; retaining its last revision",
        path.display()
    );
    files.extend(
        previous
            .iter()
            .filter(|(known, _)| known.starts_with(path))
            .map(|(path, hash)| (path.clone(), hash.clone())),
    );
}

fn scan_tree(
    root: &Path,
    directory: &Path,
    files: &mut Snapshot,
    previous: &Snapshot,
    fingerprint: fn(&Path) -> std::io::Result<String>,
    scoped: bool,
) -> std::io::Result<()> {
    let listing = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            if !scoped {
                return Err(error);
            }
            retain_unreadable(directory, files, previous, &error);
            return Ok(());
        }
    };
    let mut entries = Vec::new();
    for entry in listing {
        match entry {
            Ok(entry) => entries.push(entry),
            Err(error) => {
                if !scoped {
                    return Err(error);
                }
                retain_unreadable(directory, files, previous, &error);
                // An incomplete listing cannot prove any deletion in this directory.
                return Ok(());
            }
        }
    }
    let names: HashSet<_> = entries
        .iter()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_temporary_name(&name)
            || conflict_original(&name, &names).is_some()
            || matches!(name.as_str(), "workspace" | ".git")
            || (scoped && !is_storage_entry(path.strip_prefix(root).unwrap_or(&path)))
        {
            continue;
        }
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => {
                scan_tree(root, &path, files, previous, fingerprint, scoped)?
            }
            Ok(kind) if kind.is_file() => match fingerprint(&path) {
                Ok(hash) => {
                    files.insert(path, hash);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    if !scoped {
                        return Err(error);
                    }
                    retain_unreadable(&path, files, previous, &error);
                }
            },
            Ok(_) => {}
            Err(error) => {
                if !scoped {
                    return Err(error);
                }
                retain_unreadable(&path, files, previous, &error);
            }
        }
    }
    Ok(())
}

// Images are immutable and content-addressed. Detect arrivals/removals through
// metadata without hydrating cloud-only image files on every poll. Mutable
// entities still use hashes, even when a synchronizer preserves size and mtime.
fn is_image(path: &Path) -> bool {
    path.parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == "images")
}

fn storage_fingerprint(path: &Path) -> std::io::Result<String> {
    if is_image(path) {
        let metadata = std::fs::metadata(path)?;
        return Ok(format!(
            "image:{}:{:?}",
            metadata.len(),
            metadata.modified()?
        ));
    }
    hash_file(path)
}

const POLL_INTERVAL: Duration = Duration::from_secs(30);
const DEBOUNCE: Duration = Duration::from_millis(250);

struct ScanSchedule {
    poll: Instant,
    debounce: Option<Instant>,
}
impl ScanSchedule {
    fn new(now: Instant) -> Self {
        Self {
            poll: now + POLL_INTERVAL,
            debounce: None,
        }
    }
    fn notify(&mut self, now: Instant) {
        self.debounce = Some(now + DEBOUNCE);
    }
    fn is_due(&self, now: Instant) -> bool {
        now >= self.poll || self.debounce.is_some_and(|deadline| now >= deadline)
    }
    fn scanned(&mut self, now: Instant) {
        *self = Self::new(now);
    }
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn differences(
    before: &Snapshot,
    after: &Snapshot,
    own: &BTreeMap<PathBuf, Option<String>>,
) -> Vec<PathBuf> {
    before
        .keys()
        .chain(after.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|path| before.get(*path) != after.get(*path))
        .filter(|path| own.get(*path) != Some(&after.get(*path).cloned()))
        .cloned()
        .collect()
}

fn vault_root(app: &AppHandle, user: &UserData) -> PathBuf {
    let config = app.state::<AppState>().user_config();
    let configured = crate::models::user_config::ai_vault(&config).path;
    if configured.trim().is_empty() {
        user.dir.join("ai-vault")
    } else {
        PathBuf::from(configured)
    }
}

pub fn setup(app: &AppHandle) -> Result<(), AppError> {
    let user = app.state::<UserData>().inner().clone();
    let (sender, receiver) = mpsc::sync_channel(1);
    app.manage(StorageWatcher {
        check: Mutex::new(Some(sender.clone())),
    });
    let handle = app.clone();
    app.state::<BackgroundServices>()
        .spawn_thread("storage-watcher", move |stop| {
            let mut previous = Snapshot::new();
            let mut watched: Vec<PathBuf> = Vec::new();
            let wake = sender.clone();
            let mut watcher =
                notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    if event
                        .as_ref()
                        .is_ok_and(|event| !matches!(event.kind, notify::EventKind::Access(_)))
                    {
                        let _ = wake.try_send(());
                    }
                })
                .map_err(|error| log::warn!("Native storage watcher unavailable; polling: {error}"))
                .ok();
            let mut local = subscribe();
            let mut schedule = ScanSchedule::new(Instant::now());
            let mut pending_config = false;
            while !stop.is_stopped() {
                let vault = vault_root(&handle, &user);
                let roots = if vault.starts_with(&user.dir) {
                    vec![user.dir.clone()]
                } else {
                    vec![user.dir.clone(), vault.clone()]
                };
                if roots != watched {
                    if let Some(watcher) = watcher.as_mut() {
                        for root in &watched {
                            let _ = watcher.unwatch(root);
                        }
                        for root in &roots {
                            if let Err(error) = watcher.watch(root, RecursiveMode::Recursive) {
                                log::warn!(
                                    "Could not watch {}: {error}; polling remains enabled",
                                    root.display()
                                );
                            }
                        }
                    }
                    bus().locked().roots.clone_from(&roots);
                    watched = roots;
                    previous.clear();
                    for root in &watched {
                        let _ = scan(root, &mut previous);
                    }
                    schedule.scanned(Instant::now());
                    let _ = announce(
                        &handle,
                        &user,
                        &vault,
                        &[
                            user.dir.join("config.json"),
                            user.dir.join("tyco-user.json"),
                        ],
                    );
                }
                // Local revisions are immediate; disk echoes are suppressed by hash.
                while let Ok(event) = local.try_recv() {
                    let path = match event {
                        StorageEvent::EntityChanged { path, .. }
                        | StorageEvent::EntityDeleted { path } => path,
                    };
                    if path.starts_with(&vault) {
                        announce(&handle, &user, &vault, &[path]);
                    }
                }
                if receiver.try_recv().is_ok() {
                    schedule.notify(Instant::now());
                }
                if schedule.is_due(Instant::now()) {
                    let state = handle.state::<AppState>();
                    let current_user = user.state();
                    if state.snapshot().settings.user_data != current_user {
                        state
                            .update_snapshot(|snapshot| snapshot.settings.user_data = current_user);
                        crate::services::runtime::publish_state(&handle, &state);
                    }
                    let own = bus().locked().own.clone();
                    let mut current = Snapshot::new();
                    let result = watched
                        .iter()
                        .try_for_each(|root| scan_storage(root, &mut current, &previous));
                    match result {
                        Ok(()) => {
                            let mut changed = differences(&previous, &current, &own);
                            let config_path = user.dir.join("config.json");
                            if pending_config && !changed.contains(&config_path) {
                                changed.push(config_path);
                            }
                            if !changed.is_empty() {
                                pending_config = !announce(&handle, &user, &vault, &changed);
                            }
                            previous = current;
                            let mut bus = bus().locked();
                            bus.own.retain(|path, hash| own.get(path) != Some(hash));
                        }
                        Err(error) => log::warn!("Could not scan storage: {error}"),
                    }
                    schedule.scanned(Instant::now());
                }
                if stop.wait(Duration::from_millis(50)) {
                    break;
                }
            }
        })
}

fn announce(app: &AppHandle, user: &UserData, vault: &Path, paths: &[PathBuf]) -> bool {
    let mut applied = true;
    if paths
        .iter()
        .any(|path| path == &user.dir.join("config.json"))
        && user.is_writable()
    {
        if let Err(error) = crate::services::settings::reload_external_config(app) {
            log::warn!("Could not reload synchronized settings: {error}");
            applied = false;
        }
    }
    let relative: Vec<String> = paths
        .iter()
        .filter(|path| {
            path.file_name().is_none_or(|name| name != "tyco-user.json")
                || super::user_data::has_marker(&user.dir)
        })
        .filter_map(|path| {
            if let Ok(relative) = path.strip_prefix(vault) {
                Some(format!(
                    "ai-vault/{}",
                    relative.to_string_lossy().replace('\\', "/")
                ))
            } else {
                path.strip_prefix(&user.dir)
                    .ok()
                    .map(|relative| relative.to_string_lossy().replace('\\', "/"))
            }
        })
        .collect();
    // Derived indexes and search text must ignore preserved timestamps.
    for path in paths {
        app.state::<AppState>().history.invalidate_chat_search(path);
        if path.starts_with(user.dir.join("chats")) {
            if let Ok(dirs) = super::chat_history::app_chat_dirs(app) {
                let _ = std::fs::remove_file(dirs.index);
            }
        }
    }
    for path in paths {
        if let Ok(relative) = path.strip_prefix(vault.join("profiles")) {
            let mut parts = relative.components();
            if let (Some(profile), Some(folder)) = (parts.next(), parts.next()) {
                if folder.as_os_str() == "chats" {
                    if let Some(id) = profile.as_os_str().to_str() {
                        if let Ok(dirs) = super::chat_history::profile_chat_dirs(
                            app,
                            vault,
                            id,
                            vault.join("profiles").join(id).join("chats"),
                        ) {
                            let _ = std::fs::remove_file(dirs.index);
                        }
                    }
                }
            }
        }
    }
    if relative.iter().any(|path| path.starts_with("plugins/")) {
        let _ = crate::events::emit::<crate::events::PluginsChanged, _>(app, ());
    }
    if relative.iter().any(|path| {
        path.starts_with("history/editor/")
            && path != &format!("history/editor/{}.jsonl", user.device_id)
    }) {
        let _ = crate::events::emit::<crate::events::EditorHistoryChanged, _>(app, ());
    }
    if let Err(error) = crate::events::emit::<crate::events::StorageChanged, _>(app, relative) {
        log::warn!("Could not announce storage changes: {error}");
    }
    applied
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn content_revisions_suppress_only_matching_local_writes() {
        let path = PathBuf::from("config.json");
        let before = BTreeMap::from([(path.clone(), content_hash(b"old"))]);
        let after = BTreeMap::from([(path.clone(), content_hash(b"new"))]);
        assert_eq!(
            differences(&before, &after, &BTreeMap::new()),
            vec![path.clone()]
        );
        let own = BTreeMap::from([(path.clone(), Some(content_hash(b"new")))]);
        assert!(differences(&before, &after, &own).is_empty());
        assert_eq!(differences(&after, &before, &own), vec![path.clone()]);
        assert_eq!(
            differences(&before, &BTreeMap::new(), &own),
            vec![path.clone()]
        );
        assert!(differences(&before, &BTreeMap::new(), &BTreeMap::from([(path, None)])).is_empty());
    }

    #[test]
    fn polling_detects_edits_deletions_and_a_previously_missing_root() {
        let dir = TestDir::new("storage-polling");
        let root = dir.join("user");
        let mut before = Snapshot::new();
        scan(&root, &mut before).unwrap();
        assert!(before.is_empty());
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("config.json");
        std::fs::write(&path, b"old").unwrap();
        scan(&root, &mut before).unwrap();
        std::fs::write(&path, b"new").unwrap();
        std::fs::write(root.join(".tyco-tmp-config.json"), b"skip").unwrap();
        std::fs::write(root.join("config-LAPTOP.json"), b"conflict").unwrap();
        let mut after = Snapshot::new();
        scan(&root, &mut after).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(
            differences(&before, &after, &BTreeMap::new()),
            vec![path.clone()]
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_file(root.join("config-LAPTOP.json")).unwrap();
        let mut removed = Snapshot::new();
        scan(&root, &mut removed).unwrap();
        assert_eq!(differences(&after, &removed, &BTreeMap::new()), vec![path]);
    }

    #[test]
    fn a_busy_event_stream_cannot_postpone_the_periodic_scan() {
        let start = Instant::now();
        let mut schedule = ScanSchedule::new(start);
        for tick in 0..300 {
            let now = start + Duration::from_millis(tick * 100);
            schedule.notify(now);
            assert!(!schedule.is_due(now));
        }
        let deadline = start + POLL_INTERVAL;
        schedule.notify(deadline);
        assert!(schedule.is_due(deadline));
        schedule.scanned(deadline);
        assert!(!schedule.is_due(deadline));
        schedule.notify(deadline);
        assert!(schedule.is_due(deadline + DEBOUNCE));
    }

    #[test]
    fn scans_skip_unrelated_trees_and_do_not_open_images() {
        let dir = TestDir::new("storage-scan-scope");
        for folder in [
            ".git/objects",
            "unrelated",
            "ai-vault/.git",
            "ai-vault/profiles/p/workspace",
            "ai-vault/projects/p/src",
            "chats/images",
        ] {
            std::fs::create_dir_all(dir.join(folder)).unwrap();
            std::fs::write(dir.join(folder).join("payload"), b"skip").unwrap();
        }
        std::fs::write(dir.join("ai-vault/projects/p/notes.md"), b"skip").unwrap();
        std::fs::write(dir.join("ai-vault/projects/p/project.json"), b"{}").unwrap();
        let mut files = Snapshot::new();
        scan(&dir.join(""), &mut files).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.contains_key(&dir.join("ai-vault/projects/p/project.json")));
        let image = dir.join("chats/images/payload");
        assert!(files[&image].starts_with("image:"));
        assert_ne!(files[&image], content_hash(b"skip"));
    }

    #[test]
    fn one_unreadable_file_retains_its_revision_without_hiding_other_changes() {
        fn fingerprint(path: &Path) -> std::io::Result<String> {
            if path.file_name().is_some_and(|name| name == "config.json") {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Injected read failure",
                ))
            } else {
                hash_file(path)
            }
        }
        let dir = TestDir::new("storage-partial-scan");
        std::fs::write(dir.join("config.json"), b"unreadable").unwrap();
        std::fs::write(dir.join("tyco-user.json"), b"new marker").unwrap();
        let previous = BTreeMap::from([(dir.join("config.json"), "last good revision".into())]);
        let mut files = Snapshot::new();
        scan_tree(&dir, &dir, &mut files, &previous, fingerprint, true).unwrap();
        assert_eq!(files[&dir.join("config.json")], "last good revision");
        assert_eq!(
            differences(&previous, &files, &BTreeMap::new()),
            [dir.join("tyco-user.json")]
        );
    }

    #[test]
    fn polling_detects_mutable_entities_even_with_preserved_metadata() {
        let dir = TestDir::new("storage-preserved-metadata");
        let path = dir.join("config.json");
        std::fs::write(&path, b"old").unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        let mut before = Snapshot::new();
        scan(&dir, &mut before).unwrap();
        std::fs::write(&path, b"new").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        let mut after = Snapshot::new();
        scan_storage(&dir, &mut after, &before).unwrap();
        assert_eq!(differences(&before, &after, &BTreeMap::new()), [path]);
    }

    #[test]
    fn integration_native_watcher_observes_an_external_atomic_replacement() {
        let dir = TestDir::new("native-storage-watch");
        let (sender, receiver) = mpsc::channel();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    if !matches!(event.kind, notify::EventKind::Access(_)) {
                        let _ = sender.send(());
                    }
                }
            })
            .unwrap();
        watcher
            .watch(&dir.join(""), RecursiveMode::Recursive)
            .unwrap();
        std::fs::write(dir.join("incoming"), b"new").unwrap();
        std::fs::rename(dir.join("incoming"), dir.join("config.json")).unwrap();
        receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        let mut files = Snapshot::new();
        scan(&dir.join(""), &mut files).unwrap();
        assert_eq!(
            files.get(&dir.join("config.json")),
            Some(&content_hash(b"new"))
        );
    }
}
