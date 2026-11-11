use super::*;
use crate::services::settings::defaults::default_user_config;
use crate::services::storage::device::DeviceFile;
use crate::services::test_support::TestDir;
use serde_json::json;

fn no_notes(_: &str) -> Option<String> {
    None
}

fn fast_note(id: &str) -> Option<String> {
    (id == "FastNote").then(|| String::from("pathToNotes"))
}

struct Setup {
    dir: TestDir,
    files: ConfigFiles,
    device: DeviceStore,
}

impl Setup {
    fn new(name: &str) -> Self {
        let dir = TestDir::new(name);
        fs::create_dir_all(dir.join("user")).unwrap();
        let files = ConfigFiles::at(
            Some(dir.join("user").join(CONFIG_FILE_NAME)),
            true,
            dir.join("state").join(CONFIG_BASE_FILE_NAME),
        );
        Self {
            dir,
            files,
            device: DeviceStore::in_memory(DeviceFile::default()),
        }
    }

    fn user_path(&self) -> PathBuf {
        self.dir.join("user").join(CONFIG_FILE_NAME)
    }

    fn user_file(&self) -> Value {
        serde_json::from_str(&fs::read_to_string(self.user_path()).unwrap()).unwrap()
    }

    fn load(&self) -> LoadedUserConfig {
        self.files.load(&self.device, &no_notes).unwrap()
    }

    fn save(&self, config: &Value) -> SavedUserConfig {
        self.files
            .save(&self.device, &no_notes, config)
            .map_err(|failure| failure.error)
            .unwrap()
    }
}

#[test]
fn a_missing_config_is_created_from_the_defaults() {
    let setup = Setup::new("config-create");
    let loaded = setup.load();
    assert_eq!(loaded.value, default_user_config());
    assert!(loaded.is_complete);
    let user = setup.user_file();
    assert!(
        user.get("hotkeys").is_none(),
        "hotkeys belong to the device"
    );
    assert_eq!(user["appearance"]["theme"], "auto");
    assert!(user["appearance"].get("uiScalePercent").is_none());
}

#[test]
fn a_lossy_startup_repair_keeps_the_previous_file() {
    let setup = Setup::new("config-repair");
    let path = setup.user_path();
    let broken = json!({"appearance":{"theme":"sepia"},"unknown":1});
    fs::write(&path, broken.to_string()).unwrap();

    let loaded = setup.load();

    assert!(loaded.is_complete);
    assert_eq!(loaded.value["appearance"]["theme"], "auto");
    assert_eq!(setup.user_file()["unknown"], 1);
    let copies: Vec<_> = fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|copy| copy != &path)
        .collect();
    assert_eq!(copies.len(), 1);
    assert!(copies[0]
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("config.json.repaired-"));
    let kept: Value = serde_json::from_str(&fs::read_to_string(&copies[0]).unwrap()).unwrap();
    assert_eq!(kept, broken);
}

#[test]
fn a_repair_that_only_fills_fields_leaves_the_file_alone() {
    let setup = Setup::new("config-fill");
    let path = setup.user_path();
    let raw = r#"{"appearance":{"theme":"dark"}}"#;
    fs::write(&path, raw).unwrap();

    let loaded = setup.load();

    assert_eq!(loaded.value["appearance"]["theme"], "dark");
    assert_eq!(fs::read_to_string(&path).unwrap(), raw);
    assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
}

#[test]
fn a_newer_config_of_either_file_is_shown_and_never_written() {
    let newer = version::CONFIG_VERSION + 1;
    let setup = Setup::new("config-newer-user");
    let raw = format!(r#"{{"configVersion":{newer},"appearance":{{"theme":"dark"}}}}"#);
    fs::write(setup.user_path(), &raw).unwrap();
    let loaded = setup.load();
    assert_eq!(loaded.value["configVersion"], newer);
    assert!(!loaded.is_complete);
    assert_eq!(fs::read_to_string(setup.user_path()).unwrap(), raw);

    let setup = Setup::new("config-newer-device");
    setup
        .device
        .update(|file| file.config = json!({"configVersion": newer, "hotkeys": {}}))
        .unwrap();
    let loaded = setup.load();
    assert_eq!(version::config_version(&loaded.value), newer);
    assert!(!setup.user_path().exists());
}

#[test]
fn a_save_splits_the_config_and_a_load_joins_it() {
    let setup = Setup::new("config-split");
    let mut config = setup.load().value;
    config["hotkeys"]["voice"] = json!("Ctrl+Alt+1");
    config["appearance"]["uiScalePercent"] = json!(150);
    config["appearance"]["theme"] = json!("dark");

    setup.save(&config);

    let user = setup.user_file();
    assert_eq!(
        user["appearance"],
        json!({"theme": "dark", "contrast": "auto", "motion": "auto"})
    );
    assert!(user.get("hotkeys").is_none());
    let device = setup.device.snapshot().config;
    assert_eq!(device["hotkeys"]["voice"], "Ctrl+Alt+1");
    assert_eq!(device["appearance"], json!({"uiScalePercent": 150}));
    assert_eq!(device["configVersion"], version::CONFIG_VERSION);

    assert_eq!(setup.load().value, config);
}

#[test]
fn device_fields_found_in_the_user_file_move_to_the_device() {
    let setup = Setup::new("config-device-fields-move");
    fs::write(
        setup.user_path(),
        json!({
            "appearance": {"theme": "dark", "uiScalePercent": 150},
            "hotkeys": {"voice": "Ctrl+Alt+9"},
            "externalAccess": {"canAccessSelection": true}
        })
        .to_string(),
    )
    .unwrap();

    let loaded = setup.load();

    assert!(loaded.is_complete);
    let device = setup.device.snapshot().config;
    assert_eq!(device["hotkeys"]["voice"], "Ctrl+Alt+9");
    assert_eq!(device["appearance"]["uiScalePercent"], 150);
    assert_eq!(device["externalAccess"]["canAccessSelection"], true);
    let user = setup.user_file();
    assert!(user.get("hotkeys").is_none());
    assert!(user["appearance"].get("uiScalePercent").is_none());
    assert_eq!(user["appearance"]["theme"], "dark");
    // and a second start keeps them
    let again = setup.load();
    assert_eq!(again.value["hotkeys"]["voice"], "Ctrl+Alt+9");
    assert_eq!(again.value["appearance"]["uiScalePercent"], 150);
}

#[test]
fn unknown_fields_go_back_to_their_own_file() {
    let setup = Setup::new("config-unknown");
    fs::write(
        setup.user_path(),
        json!({"appearance": {"theme": "dark", "fromUser": 1}}).to_string(),
    )
    .unwrap();
    setup
        .device
        .update(|file| file.config = json!({"appearance": {"fromDevice": 2}, "deviceOnly": 3}))
        .unwrap();
    let mut config = setup.load().value;
    assert_eq!(config["appearance"]["fromDevice"], 2);
    config["appearance"]["theme"] = json!("light");

    setup.save(&config);

    let user = setup.user_file();
    assert_eq!(user["appearance"]["fromUser"], 1);
    assert!(user["appearance"].get("fromDevice").is_none());
    assert!(user.get("deviceOnly").is_none());
    let device = setup.device.snapshot().config;
    assert_eq!(device["appearance"]["fromDevice"], 2);
    assert_eq!(device["deviceOnly"], 3);
    assert!(device["appearance"].get("fromUser").is_none());
}

#[test]
fn a_folder_that_is_not_connected_is_never_written() {
    let dir = TestDir::new("config-not-connected");
    let files = ConfigFiles::at(None, false, dir.join("state").join(CONFIG_BASE_FILE_NAME));
    let device = DeviceStore::in_memory(DeviceFile {
        config: json!({"hotkeys": {"voice": "Ctrl+Alt+9"}}),
        ..DeviceFile::default()
    });
    let loaded = files.load(&device, &no_notes).unwrap();
    assert_eq!(loaded.value["hotkeys"]["voice"], "Ctrl+Alt+9");
    assert!(!loaded.is_complete);
    assert!(matches!(
        files.save(&device, &no_notes, &loaded.value),
        Err(SaveFailure {
            error: AppError::UserDataUnavailable(_),
            ..
        })
    ));
    assert_eq!(fs::read_dir(&*dir).unwrap().count(), 0);
}

#[test]
fn a_change_another_device_synced_survives_a_save() {
    let setup = Setup::new("config-merge");
    let mut config = setup.load().value;
    // another device changes the theme meanwhile
    let mut disk = setup.user_file();
    disk["appearance"]["theme"] = json!("dark");
    fs::write(setup.user_path(), disk.to_string()).unwrap();

    config["language"]["ui"] = json!("ru-RU");
    let saved = setup.save(&config);

    assert!(saved.conflicts.is_empty());
    assert_eq!(saved.value["appearance"]["theme"], "dark");
    assert_eq!(saved.value["language"]["ui"], "ru-RU");
    let user = setup.user_file();
    assert_eq!(user["appearance"]["theme"], "dark");
    assert_eq!(user["language"]["ui"], "ru-RU");

    // the next save compares with what it wrote: no merge, no conflict
    config = saved.value;
    config["appearance"]["theme"] = json!("light");
    let saved = setup.save(&config);
    assert!(saved.conflicts.is_empty());
    assert_eq!(setup.user_file()["appearance"]["theme"], "light");
}

#[test]
fn the_changes_of_the_disk_are_merged_before_a_save_without_writing() {
    let setup = Setup::new("config-merge-before-save");
    let mut config = setup.load().value;
    let mut disk = setup.user_file();
    disk["editor"]["history"]["retentionDays"] = json!(7);
    fs::write(setup.user_path(), disk.to_string()).unwrap();
    let written = fs::read(setup.user_path()).unwrap();

    config["language"]["ui"] = json!("ru-RU");
    let merged = setup
        .files
        .with_disk_changes(&setup.device, &no_notes, &config)
        .unwrap();
    assert_eq!(merged.value["editor"]["history"]["retentionDays"], 7);
    assert_eq!(merged.value["language"]["ui"], "ru-RU");
    assert!(merged.conflicts.is_empty());
    assert_eq!(fs::read(setup.user_path()).unwrap(), written);

    // the save that follows finds nothing new to merge
    let saved = setup.save(&merged.value);
    assert!(saved.conflicts.is_empty());
    assert_eq!(saved.value, merged.value);
}

#[test]
fn a_field_both_devices_changed_takes_the_change_of_this_one() {
    let setup = Setup::new("config-merge-conflict");
    let mut config = setup.load().value;
    let mut disk = setup.user_file();
    disk["appearance"]["theme"] = json!("dark");
    fs::write(setup.user_path(), disk.to_string()).unwrap();

    config["appearance"]["theme"] = json!("eInk");
    let saved = setup.save(&config);

    assert_eq!(saved.conflicts, ["userConfig.appearance.theme"]);
    assert_eq!(setup.user_file()["appearance"]["theme"], "eInk");
    let kept = fs::read_dir(setup.dir.join("user"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.to_string_lossy().contains(".disk-"))
        .expect("the version of the disk is kept");
    let kept: Value = serde_json::from_str(&fs::read_to_string(kept).unwrap()).unwrap();
    assert_eq!(kept["appearance"]["theme"], "dark");
}

#[test]
fn without_a_base_the_disk_is_taken_as_it_is() {
    let setup = Setup::new("config-no-base");
    fs::write(
        setup.user_path(),
        json!({"appearance": {"theme": "dark"}}).to_string(),
    )
    .unwrap();
    let loaded = setup.load();
    assert_eq!(loaded.value["appearance"]["theme"], "dark");
    let base: Value = serde_json::from_str(
        &fs::read_to_string(setup.dir.join("state").join(CONFIG_BASE_FILE_NAME)).unwrap(),
    )
    .unwrap();
    assert_eq!(base["config"]["appearance"]["theme"], "dark");
}

#[test]
fn notes_folders_stay_on_the_device() {
    let setup = Setup::new("config-notes");
    let mut config = setup.files.load(&setup.device, &fast_note).unwrap().value;
    config["plugins"]["FastNote"] =
        json!({"isEnabled": true, "settings": {"pathToNotes": "/notes", "mode": "daily"}});
    config["commands"] = json!([
        {"id": "inbox", "toolId": "FastNote.addNote", "toolConfig": {"pathToNotes": "/inbox"}},
        {"id": "other", "toolId": "script", "toolConfig": {"pathToNotes": "/kept"}}
    ]);
    let config = {
        let mut repaired = config;
        schema::normalize_user_config(&mut repaired);
        repaired
    };

    setup
        .files
        .save(&setup.device, &fast_note, &config)
        .map_err(|failure| failure.error)
        .unwrap();

    let user = setup.user_file();
    assert_eq!(user["plugins"]["FastNote"]["settings"]["pathToNotes"], "");
    assert_eq!(user["plugins"]["FastNote"]["settings"]["mode"], "daily");
    assert_eq!(user["commands"][0]["toolConfig"]["pathToNotes"], "");
    assert_eq!(user["commands"][1]["toolConfig"]["pathToNotes"], "/kept");
    let device = setup.device.snapshot();
    assert_eq!(device.plugin_paths["FastNote"], "/notes");
    assert_eq!(device.plugin_command_paths["inbox"], "/inbox");

    let loaded = setup.files.load(&setup.device, &fast_note).unwrap().value;
    assert_eq!(
        loaded["plugins"]["FastNote"]["settings"]["pathToNotes"],
        "/notes"
    );
    assert_eq!(loaded["commands"][0]["toolConfig"]["pathToNotes"], "/inbox");
    assert_eq!(
        crate::services::plugins::approved_note_roots(&loaded, "FastNote", "pathToNotes").unwrap(),
        ["/notes", "/inbox"]
    );

    // the folder of a removed command goes with it
    let mut without = loaded;
    without["commands"].as_array_mut().unwrap().remove(0);
    setup
        .files
        .save(&setup.device, &fast_note, &without)
        .map_err(|failure| failure.error)
        .unwrap();
    assert!(setup.device.snapshot().plugin_command_paths.is_empty());
}

fn device_with_notes() -> DeviceFile {
    DeviceFile {
        plugin_paths: [(String::from("FastNote"), String::from("/notes"))].into(),
        plugin_command_paths: [(String::from("inbox"), String::from("/inbox"))].into(),
        ..DeviceFile::default()
    }
}

#[test]
fn notes_folders_survive_a_config_that_was_not_read() {
    // the folder is not connected
    let dir = TestDir::new("config-notes-not-connected");
    let files = ConfigFiles::at(None, false, dir.join("state").join(CONFIG_BASE_FILE_NAME));
    let device = DeviceStore::in_memory(device_with_notes());
    files.load(&device, &fast_note).unwrap();
    assert_eq!(device.snapshot(), device_with_notes());

    // the config is broken, or missing
    for raw in [Some("{ broken"), None] {
        let setup = Setup::new("config-notes-broken");
        if let Some(raw) = raw {
            fs::write(setup.user_path(), raw).unwrap();
        }
        let device = DeviceStore::in_memory(device_with_notes());
        setup.files.load(&device, &fast_note).unwrap();
        let snapshot = device.snapshot();
        assert_eq!(snapshot.plugin_paths, device_with_notes().plugin_paths);
        assert_eq!(
            snapshot.plugin_command_paths,
            device_with_notes().plugin_command_paths
        );
    }
}

fn device_with_variable_values() -> DeviceFile {
    DeviceFile {
        config: json!({"variableValues": {"notes": "/notes"}}),
        ..DeviceFile::default()
    }
}

#[test]
fn variable_values_stay_on_the_device_and_go_with_their_variable() {
    let setup = Setup::new("config-variables");
    let mut config = setup.load().value;
    config["variables"] = json!([{"id": "notes", "name": "NOTES_DIR"}]);
    config["variableValues"] = json!({"notes": "/notes"});
    setup.save(&config);
    assert_eq!(setup.user_file()["variables"][0]["name"], "NOTES_DIR");
    assert!(setup.user_file().get("variableValues").is_none());
    assert_eq!(
        setup.device.snapshot().config["variableValues"],
        json!({"notes": "/notes"})
    );
    assert_eq!(setup.load().value["variableValues"]["notes"], "/notes");

    // another device removed the variable: its value goes on this one
    let mut user = setup.user_file();
    user["variables"] = json!([]);
    fs::write(setup.user_path(), user.to_string()).unwrap();
    let loaded = setup.load().value;
    assert_eq!(loaded["variableValues"], json!({}));
    assert_eq!(setup.device.snapshot().config["variableValues"], json!({}));
}

#[test]
fn variable_values_survive_a_config_that_was_not_read() {
    let dir = TestDir::new("config-variables-not-connected");
    let files = ConfigFiles::at(None, false, dir.join("state").join(CONFIG_BASE_FILE_NAME));
    let device = DeviceStore::in_memory(device_with_variable_values());
    files.load(&device, &no_notes).unwrap();
    assert_eq!(
        device.snapshot().config["variableValues"],
        json!({"notes": "/notes"})
    );

    for raw in [Some("{ broken"), None] {
        let setup = Setup::new("config-variables-broken");
        if let Some(raw) = raw {
            fs::write(setup.user_path(), raw).unwrap();
        }
        let device = DeviceStore::in_memory(device_with_variable_values());
        setup.files.load(&device, &no_notes).unwrap();
        assert_eq!(
            device.snapshot().config["variableValues"],
            json!({"notes": "/notes"})
        );
    }
}

#[test]
fn a_config_that_was_read_drops_the_folders_of_removed_commands_only() {
    let setup = Setup::new("config-notes-read");
    fs::write(setup.user_path(), json!({"commands": []}).to_string()).unwrap();
    let device = DeviceStore::in_memory(device_with_notes());
    let loaded = setup.files.load(&device, &fast_note).unwrap().value;
    let snapshot = device.snapshot();
    assert!(snapshot.plugin_command_paths.is_empty());
    // a plugin without saved settings keeps the folder of this device
    assert_eq!(snapshot.plugin_paths["FastNote"], "/notes");

    setup
        .files
        .save(&device, &fast_note, &loaded)
        .map_err(|failure| failure.error)
        .unwrap();
    assert_eq!(device.snapshot().plugin_paths["FastNote"], "/notes");
}

#[test]
fn a_file_broken_while_running_is_kept_aside_and_replaced() {
    let setup = Setup::new("config-broken-on-save");
    let config = setup.load().value;
    for broken in [&b"{\"appearance\": "[..], &[0xff, 0xfe][..]] {
        fs::write(setup.user_path(), broken).unwrap();
        setup.save(&config);
        assert_eq!(setup.user_file()["appearance"]["theme"], "auto");
        let kept = fs::read_dir(setup.dir.join("user"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .any(|copy| copy != setup.user_path() && fs::read(&copy).unwrap() == broken);
        assert!(kept, "the broken bytes are kept");
    }
}

#[test]
fn a_config_set_aside_as_broken_makes_the_config_incomplete() {
    let setup = Setup::new("config-broken-incomplete");
    fs::write(setup.user_path(), "{ broken").unwrap();
    let loaded = setup.load();
    assert!(!loaded.is_complete);
    assert_eq!(loaded.value, default_user_config());
}

#[test]
fn a_conflicting_copy_of_a_sync_tool_makes_the_config_incomplete() {
    let setup = Setup::new("config-conflict-copy");
    setup.load();
    fs::write(
        setup
            .dir
            .join("user/config.sync-conflict-20261101-120000-ABC.json"),
        "{}",
    )
    .unwrap();
    assert!(!setup.load().is_complete);
}

#[test]
fn keeping_every_value_ignores_added_fields_and_the_version() {
    let original = json!({"configVersion": 0, "a": {"b": [1, {"c": 2}]}});
    assert!(keeps_every_value(
        &original,
        &json!({"configVersion": 1, "a": {"b": [1, {"c": 2, "d": 3}], "e": 4}})
    ));
    assert!(!keeps_every_value(&original, &json!({"a": {"b": [1]}})));
    assert!(!keeps_every_value(&json!({"x": 1}), &json!({})));
}

#[test]
fn missing_sections_come_from_the_defaults() {
    let defaults = default_user_config();
    let mut config = serde_json::json!({});
    assert!(schema::normalize_user_config(&mut config));
    assert_eq!(config, defaults);
    assert!(!schema::normalize_user_config(&mut config));
}

/// Two devices write one user data folder in turns, each with its own state
/// and device file: no change of either is lost, and the device settings of
/// one never reach the other.
#[test]
fn two_devices_on_one_folder_keep_each_others_changes() {
    let dir = TestDir::new("config-two-devices");
    fs::create_dir_all(dir.join("user")).unwrap();
    let user_path = dir.join("user").join(CONFIG_FILE_NAME);
    let device = |name: &str| {
        (
            ConfigFiles::at(
                Some(user_path.clone()),
                true,
                dir.join(name).join(CONFIG_BASE_FILE_NAME),
            ),
            DeviceStore::in_memory(DeviceFile::default()),
        )
    };
    let (laptop_files, laptop) = device("laptop");
    let (desktop_files, desktop) = device("desktop");
    let save = |files: &ConfigFiles, store: &DeviceStore, config: &Value| {
        files
            .save(store, &no_notes, config)
            .map_err(|failure| failure.error)
            .unwrap()
            .value
    };

    let mut on_laptop = laptop_files.load(&laptop, &no_notes).unwrap().value;
    let mut on_desktop = desktop_files.load(&desktop, &no_notes).unwrap().value;

    on_laptop["appearance"]["theme"] = json!("dark");
    on_laptop["hotkeys"]["voice"] = json!("Ctrl+Alt+L");
    on_laptop = save(&laptop_files, &laptop, &on_laptop);

    // the desktop has not seen the change of the laptop
    on_desktop["language"]["ui"] = json!("ru-RU");
    on_desktop["hotkeys"]["voice"] = json!("Ctrl+Alt+D");
    on_desktop = save(&desktop_files, &desktop, &on_desktop);
    assert_eq!(on_desktop["appearance"]["theme"], "dark");

    on_laptop["editor"]["submitKey"] = json!("Ctrl+Enter");
    let on_laptop = save(&laptop_files, &laptop, &on_laptop);
    assert_eq!(on_laptop["language"]["ui"], "ru-RU");

    let user: Value = serde_json::from_str(&fs::read_to_string(&user_path).unwrap()).unwrap();
    assert_eq!(user["appearance"]["theme"], "dark");
    assert_eq!(user["language"]["ui"], "ru-RU");
    assert_eq!(user["editor"]["submitKey"], "Ctrl+Enter");
    assert!(user.get("hotkeys").is_none());
    assert_eq!(laptop.snapshot().config["hotkeys"]["voice"], "Ctrl+Alt+L");
    assert_eq!(desktop.snapshot().config["hotkeys"]["voice"], "Ctrl+Alt+D");
    assert_eq!(on_laptop["hotkeys"]["voice"], "Ctrl+Alt+L");
}

#[test]
fn external_revision_merges_unsaved_changes_without_rewriting_shared_config() {
    let setup = Setup::new("external-config-merge");
    let mut current = setup.load().value;
    current["language"]["ui"] = json!("ru-RU");
    let mut disk = setup.user_file();
    disk["appearance"]["theme"] = json!("dark");
    fs::write(setup.user_path(), serde_json::to_vec(&disk).unwrap()).unwrap();
    let raw = fs::read(setup.user_path()).unwrap();
    let merged = setup
        .files
        .accept_external(&setup.device, &no_notes, &current, |merged| {
            assert_eq!(merged.value["appearance"]["theme"], "dark");
            assert_eq!(merged.value["language"]["ui"], "ru-RU");
            Ok(())
        })
        .unwrap();
    assert_eq!(fs::read(setup.user_path()).unwrap(), raw);
    assert_eq!(setup.files.read_base(), Some(disk));
    let saved = setup.save(&merged.value);
    assert_eq!(saved.value["language"]["ui"], "ru-RU");
    assert_eq!(saved.value["appearance"]["theme"], "dark");
}

#[test]
fn failed_external_application_keeps_the_base_for_retry_and_rejects_bad_input() {
    let setup = Setup::new("external-config-retry");
    let current = setup.load().value;
    let base = setup.files.read_base();
    let mut disk = setup.user_file();
    disk["appearance"]["theme"] = json!("dark");
    fs::write(setup.user_path(), serde_json::to_vec(&disk).unwrap()).unwrap();
    assert!(setup
        .files
        .accept_external(&setup.device, &no_notes, &current, |_| {
            Err(AppError::Failed("History unavailable".into()))
        })
        .is_err());
    assert_eq!(setup.files.read_base(), base);
    for raw in ["{partial", "[]", r#"{"configVersion":999}"#] {
        fs::write(setup.user_path(), raw).unwrap();
        assert!(setup
            .files
            .accept_external(&setup.device, &no_notes, &current, |_| panic!(
                "Invalid config must not be applied"
            ))
            .is_err());
        assert_eq!(setup.files.read_base(), base);
        assert_eq!(fs::read_to_string(setup.user_path()).unwrap(), raw);
    }
}

#[test]
fn external_conflict_keeps_local_edits_and_preserves_the_losing_disk_revision() {
    let setup = Setup::new("external-config-conflict");
    let mut current = setup.load().value;
    current["appearance"]["theme"] = json!("light");
    let mut disk = setup.user_file();
    disk["appearance"]["theme"] = json!("dark");
    fs::write(setup.user_path(), serde_json::to_vec(&disk).unwrap()).unwrap();
    let merged = setup
        .files
        .accept_external(&setup.device, &no_notes, &current, |_| Ok(()))
        .unwrap();
    assert_eq!(merged.value["appearance"]["theme"], "light");
    assert!(!merged.conflicts.is_empty());
    assert_eq!(setup.user_file(), disk);
    assert_eq!(setup.files.read_base(), Some(disk));
}

#[test]
fn an_external_revision_without_a_cached_base_takes_the_disk_and_keeps_device_fields() {
    let setup = Setup::new("external-config-no-base");
    let current = setup.load().value;
    fs::remove_file(&setup.files.base_path).unwrap();
    let mut disk = setup.user_file();
    disk["appearance"]["theme"] = json!("dark");
    fs::write(setup.user_path(), serde_json::to_vec(&disk).unwrap()).unwrap();
    let merged = setup
        .files
        .accept_external(&setup.device, &no_notes, &current, |_| Ok(()))
        .unwrap();
    assert_eq!(merged.value["appearance"]["theme"], "dark");
    assert_eq!(merged.value["hotkeys"], current["hotkeys"]);
    assert_eq!(setup.user_file(), disk);
}

#[test]
fn a_broken_read_only_config_is_left_in_place() {
    let setup = Setup::new("config-read-only-broken");
    let raw = b"{broken";
    fs::write(setup.user_path(), raw).unwrap();
    let files = ConfigFiles::at(
        Some(setup.user_path()),
        false,
        setup.dir.join("state/base.json"),
    );
    let loaded = files.load(&setup.device, &no_notes).unwrap();
    assert!(!loaded.is_complete);
    assert_eq!(fs::read(setup.user_path()).unwrap(), raw);
    assert_eq!(fs::read_dir(setup.dir.join("user")).unwrap().count(), 1);
}

#[test]
fn a_conflict_is_not_overwritten_when_recovery_cannot_be_written() {
    let setup = Setup::new("config-conflict-recovery-failure");
    let mut local = setup.load().value;
    local["appearance"]["theme"] = json!("dark");
    let mut disk = setup.user_file();
    disk["appearance"]["theme"] = json!("light");
    let raw = serde_json::to_vec(&disk).unwrap();
    fs::write(setup.user_path(), &raw).unwrap();
    let recovery = setup.dir.join("recovery-blocked");
    fs::write(&recovery, "not a directory").unwrap();
    crate::services::atomic_file::register_recovery_root(&setup.dir.join("user"), &recovery);
    let device = setup.device.snapshot();
    assert!(setup.files.save(&setup.device, &no_notes, &local).is_err());
    assert_eq!(fs::read(setup.user_path()).unwrap(), raw);
    assert_eq!(setup.device.snapshot(), device);
}

#[test]
fn a_disk_change_after_preparation_requires_runtime_reconciliation_again() {
    let setup = Setup::new("config-prepared-race");
    let config = setup.load().value;
    let prepared = setup
        .files
        .with_disk_changes(&setup.device, &no_notes, &config)
        .unwrap();
    let mut disk = setup.user_file();
    disk["editor"]["history"]["retentionDays"] = json!(7);
    let raw = serde_json::to_vec(&disk).unwrap();
    fs::write(setup.user_path(), &raw).unwrap();
    let failure = setup
        .files
        .save(&setup.device, &no_notes, &prepared.value)
        .err()
        .unwrap();
    assert!(matches!(failure.error, AppError::Stale(_)));
    assert_eq!(fs::read(setup.user_path()).unwrap(), raw);
    let prepared = setup
        .files
        .with_disk_changes(&setup.device, &no_notes, &config)
        .unwrap();
    assert_eq!(prepared.value["editor"]["history"]["retentionDays"], 7);
    assert_eq!(setup.save(&prepared.value).value, prepared.value);
}

#[test]
fn cached_config_files_do_not_write_after_the_root_disappears() {
    let dir = TestDir::new("cached-config-disconnect");
    let root = dir.join("user");
    fs::create_dir(&root).unwrap();
    crate::services::storage::user_data::write_marker(&root).unwrap();
    let data = crate::services::storage::user_data::UserData::resolve(&root, "");
    crate::services::storage::user_data::register_write_guard(&data);
    let files = ConfigFiles::new(&data, &dir.join("state"));
    let device = DeviceStore::in_memory(DeviceFile::default());
    let config = files.load(&device, &no_notes).unwrap().value;
    fs::rename(&root, dir.join("unmounted")).unwrap();
    assert!(files.save(&device, &no_notes, &config).is_err());
    assert!(!root.exists());
}

#[test]
fn a_lossy_repair_does_not_overwrite_a_file_when_recovery_is_unavailable() {
    let setup = Setup::new("config-repair-recovery-failure");
    let raw = br#"{"appearance":{"theme":"invalid"}}"#;
    fs::write(setup.user_path(), raw).unwrap();
    let recovery = setup.dir.join("blocked-recovery");
    fs::write(&recovery, "not a directory").unwrap();
    crate::services::atomic_file::register_recovery_root(&setup.dir.join("user"), &recovery);
    let loaded = setup.load();
    assert!(!loaded.is_complete);
    assert_eq!(loaded.value["appearance"]["theme"], "auto");
    assert_eq!(fs::read(setup.user_path()).unwrap(), raw);
}

#[test]
fn main_vault_references_are_canonical_on_load_save_and_external_merge() {
    let setup = Setup::new("config-main-vault-references");
    let user_dir = setup.dir.join("user");
    crate::services::storage::user_data::write_marker(&user_dir).unwrap();
    let main_id = crate::services::ai_vault::marker::main_vault_id(&user_dir);
    let reference = json!({"type":"profileChat", "profileId":"writer", "vaultId":main_id});
    let mut config = default_user_config();
    config["actionPages"][0]["slots"]["q"] = reference.clone();
    fs::write(setup.user_path(), config.to_string()).unwrap();
    let loaded = setup.load().value;
    assert!(loaded["actionPages"][0]["slots"]["q"]
        .get("vaultId")
        .is_none());
    let mut local = loaded;
    local["actionPages"][0]["slots"]["q"] = reference.clone();
    let saved = setup.save(&local);
    assert!(saved.value["actionPages"][0]["slots"]["q"]
        .get("vaultId")
        .is_none());
    assert!(setup.user_file()["actionPages"][0]["slots"]["q"]
        .get("vaultId")
        .is_none());
    let mut remote = setup.user_file();
    remote["actionPages"][0]["slots"]["q"] = reference;
    remote["appearance"]["theme"] = json!("dark");
    fs::write(setup.user_path(), remote.to_string()).unwrap();
    let saved = setup.save(&saved.value);
    assert_eq!(saved.value["appearance"]["theme"], "dark");
    assert!(setup.user_file()["actionPages"][0]["slots"]["q"]
        .get("vaultId")
        .is_none());
}
