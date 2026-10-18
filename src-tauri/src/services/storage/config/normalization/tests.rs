use super::*;
use crate::models::default_user_config;
use serde_json::{json, Value};

#[test]
fn window_insertion_defaults_follow_the_injected_session() {
    use super::window_insertion::normalize_window_insertion_for_session;
    use crate::services::platform::session::{Desktop, DisplayServer, Session};

    for (display, expected_method) in [
        (DisplayServer::X11, "xdotool"),
        (DisplayServer::Wayland, "ydotool"),
        (DisplayServer::Native, "xdotool"),
        (DisplayServer::Unknown, "xdotool"),
    ] {
        let session = Session {
            display,
            desktop: Desktop::Other,
        };
        for mut config in [
            json!({}),
            json!({ "windowInsertion": "invalid" }),
            json!({ "windowInsertion": { "linux": { "method": "wtype" } } }),
        ] {
            assert!(normalize_window_insertion_for_session(&mut config, session));
            assert_eq!(
                config["windowInsertion"]["linux"]["method"],
                expected_method
            );
            assert!(!normalize_window_insertion_for_session(
                &mut config,
                session
            ));
        }
        let mut custom =
            json!({ "windowInsertion": { "linux": { "xdotoolPath": "/opt/bin/xdotool" } } });
        normalize_window_insertion_for_session(&mut custom, session);
        assert_eq!(
            custom["windowInsertion"]["linux"]["xdotoolPath"],
            "/opt/bin/xdotool"
        );
        for method in ["xdotool", "ydotool"] {
            let mut config = json!({ "windowInsertion": { "linux": { "method": method } } });
            assert!(!normalize_window_insertion_for_session(
                &mut config,
                session
            ));
            assert_eq!(config["windowInsertion"]["linux"]["method"], method);
        }
    }
}

#[test]
fn normalize_window_insertion_is_idempotent() {
    let mut config = json!({});

    assert!(normalize_window_insertion_config(&mut config));
    assert!(!normalize_window_insertion_config(&mut config));
}

#[test]
fn normalize_hotkeys_adds_defaults_and_keeps_overrides() {
    let mut config = json!({ "hotkeys": { "editor": "Super+Space" } });

    assert!(normalize_hotkeys_config(&mut config));
    assert_eq!(config["hotkeys"]["editor"], json!("Super+Space"));
    assert_eq!(config["hotkeys"]["voice"], json!("Ctrl+Alt+V"));
    assert_eq!(
        config["hotkeys"]["selectionCorrection"],
        default_user_config()["hotkeys"]["selectionCorrection"]
    );
    assert!(!normalize_hotkeys_config(&mut config));
}

#[test]
fn normalize_hotkeys_drops_unknown_targets() {
    let mut config = json!({
        "hotkeys": {
            "history": "Ctrl+H",
            "commandLauncher2": "Ctrl+2",
            "correction": "Ctrl+Alt+C"
        },
    });

    assert!(normalize_hotkeys_config(&mut config));
    assert!(config["hotkeys"].get("history").is_none());
    assert!(config["hotkeys"].get("commandLauncher2").is_none());
    assert_eq!(config["hotkeys"]["correction"], json!("Ctrl+Alt+C"));
    assert!(!normalize_hotkeys_config(&mut config));
}

#[test]
fn normalize_language_restores_the_translation_slots() {
    let mut config = json!({"translation":{"targetLanguages": {}}});

    assert!(normalize_language_config(&mut config));
    assert_eq!(
        config["translation"]["targetLanguages"],
        json!({ "q": "en_US" })
    );
    assert!(!normalize_language_config(&mut config));

    let mut preserves = json!({"translation":{"targetLanguages": { "w": "es_AR" }}});
    assert!(!normalize_language_config(&mut preserves));
    assert_eq!(
        preserves["translation"]["targetLanguages"],
        json!({ "w": "es_AR" })
    );
}

#[test]
fn domain_normalizers_ignore_non_mapping_configs() {
    let normalizers: [fn(&mut Value) -> bool; 3] = [
        normalize_window_insertion_config,
        normalize_hotkeys_config,
        normalize_language_config,
    ];
    for normalize in normalizers {
        for mut config in [Value::Null, json!([]), json!("invalid")] {
            let original = config.clone();
            assert!(!normalize(&mut config));
            assert_eq!(config, original);
        }
    }
}

#[test]
fn loaded_config_fills_missing_sections_from_defaults() {
    let defaults = default_user_config();
    let mut config = json!({});

    assert!(super::super::normalize_loaded_config(&mut config));
    for key in [
        "appearance",
        "language",
        "editor",
        "quickWindow",
        "editorHistory",
        "chatHistory",
        "translation",
        "mainActions",
        "commands",
        "aiRules",
        "aiTasks",
        "plugins",
        "stt",
    ] {
        assert_eq!(config[key], defaults[key], "{key}");
    }
    assert!(!super::super::normalize_loaded_config(&mut config));
}

#[test]
fn loaded_config_repairs_invalid_fields_without_overwriting_valid_values() {
    let defaults = default_user_config();
    let mut config = json!({
        "language": { "ui": "es_AR", "user": false },
        "editor": { "submitKey": "Ctrl+Enter" },
        "hotkeys": { "selectionCorrection": "Ctrl+Alt+X", "translate.0": "Ctrl+Alt+1" },
        "translation": {
            "provider": "google",
            "qualityGate": "invalid",
            "deeplEndpoint": 1,
            "glossary": {},
            "qualityGatePrompt": "custom prompt",
            "targetLanguages": []
        },
        "mainActions": "invalid",
        "chatRoles": ["legacy"],
        "appearance": { "theme": "e-ink", "contrast": null, "motion": "unknown", "uiScalePercent": 201 },
        "editorHistory": { "maxItems": -1, "retentionDays": 1.5, "isSecretSanitizingEnabled": "true" },
        "chatHistory": { "isEnabled": false, "retentionDays": 0 },
        "stt": { "providerId": "sherpaOnnx", "isLlmFormattingEnabled": "no", "providers": { "sherpaOnnx": { "baseUrl": "ws://speech.lan:6006" } } }
    });
    assert!(super::super::normalize_loaded_config(&mut config));

    for path in [
        "/appearance/contrast",
        "/appearance/motion",
        "/appearance/uiScalePercent",
        "/language/user",
        "/translation/targetLanguages",
        "/editor/submitKey",
        "/editorHistory/maxItems",
        "/editorHistory/retentionDays",
        "/editorHistory/isSecretSanitizingEnabled",
        "/mainActions",
        "/stt/providers/deepgram",
        "/stt/isLlmFormattingEnabled",
    ] {
        assert_eq!(config.pointer(path), defaults.pointer(path), "{path}");
    }
    for key in ["qualityGate", "deeplEndpoint", "glossary"] {
        assert_eq!(
            config["translation"][key], defaults["translation"][key],
            "{key}"
        );
    }
    assert_eq!(config["appearance"]["theme"], "e-ink");
    assert_eq!(config["language"]["ui"], "es_AR");
    assert_eq!(config["chatHistory"]["isEnabled"], false);
    assert_eq!(config["chatHistory"]["retentionDays"], 0);
    assert_eq!(config["hotkeys"]["selectionCorrection"], "Ctrl+Alt+X");
    assert!(config["hotkeys"].get("translate.0").is_none());
    assert_eq!(config["translation"]["provider"], "google");
    assert_eq!(config["translation"]["qualityGatePrompt"], "custom prompt");
    assert_eq!(config["stt"]["providerId"], "sherpaOnnx");
    assert_eq!(
        config["stt"]["providers"]["sherpaOnnx"]["baseUrl"],
        "ws://speech.lan:6006"
    );
    assert!(config.get("chatRoles").is_none());

    assert!(!super::super::normalize_loaded_config(&mut config));
}
