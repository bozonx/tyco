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
    bus.own.insert(path.clone(), hash);
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
    check: Mutex<Option<mpsc::Sender<()>>>,
}
pub fn check_now(app: &AppHandle) {
    if let Some(watcher) = app.try_state::<StorageWatcher>() {
        if let Some(sender) = watcher.check.locked().as_ref() {
            let _ = sender.send(());
        }
    }
}

type Snapshot = BTreeMap<PathBuf, String>;
fn scan(root: &Path, files: &mut Snapshot) -> std::io::Result<()> {
    scan_with(root, files, hash_file)
}

fn scan_with(
    root: &Path,
    files: &mut Snapshot,
    fingerprint: fn(&Path) -> std::io::Result<String>,
) -> std::io::Result<()> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries.collect::<Result<Vec<_>, _>>()?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let names: HashSet<_> = entries
        .iter()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_temporary_name(&name)
            || conflict_original(&name, &names).is_some()
            || name == "workspace"
        {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_dir() {
            scan_with(&entry.path(), files, fingerprint)?;
        } else if kind.is_file() {
            match fingerprint(&entry.path()) {
                Ok(hash) => {
                    files.insert(entry.path(), hash);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
    }
    Ok(())
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
    let (sender, receiver) = mpsc::channel();
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
                        let _ = wake.send(());
                    }
                })
                .map_err(|error| log::warn!("Native storage watcher unavailable; polling: {error}"))
                .ok();
            let mut local = subscribe();
            let mut next_scan = Instant::now();
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
                    next_scan = Instant::now() + Duration::from_secs(30);
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
                    next_scan = Instant::now() + Duration::from_millis(250);
                    while receiver.try_recv().is_ok() {}
                }
                if Instant::now() >= next_scan {
                    let own = bus().locked().own.clone();
                    let mut current = Snapshot::new();
                    let result = watched.iter().try_for_each(|root| scan(root, &mut current));
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
                    next_scan = Instant::now() + Duration::from_secs(30);
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
    // Derived indexes must be rebuilt even if a synchronizer preserved mtime.
    for path in paths {
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
