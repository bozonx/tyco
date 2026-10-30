use serde_json::json;

use super::*;

fn config() -> Value {
    json!({
        "commands": [
            {
                "id": "backup",
                "name": "Бэкап",
                "toolId": "script",
                "toolConfig": { "command": "backup.sh" },
                "isAvailableExternally": true
            },
            {
                "id": "note",
                "name": "Work  Note",
                "toolId": "webhook",
                "toolConfig": { "url": "https://example.com/?q={{TEXT}}" },
                "afterRun": "showMenu",
                "isAvailableExternally": true
            },
            {
                "id": "hidden",
                "name": "Hidden",
                "toolId": "script",
                "toolConfig": { "command": "x" },
                "isAvailableExternally": false
            },
            {
                "id": "off",
                "name": "Off",
                "toolId": "script",
                "toolConfig": { "command": "x" },
                "isEnabled": false,
                "isAvailableExternally": true
            },
            {
                "id": "plugin",
                "name": "Plugin",
                "toolId": "FastNote.write",
                "isAvailableExternally": true
            },
            {
                "id": "missing-tool",
                "name": "Missing",
                "toolId": "Gone.tool",
                "isAvailableExternally": true
            },
            {
                "id": "translate",
                "name": "Translate",
                "toolId": "core.translate",
                "afterRun": "insertIntoWindow",
                "isAvailableExternally": true
            },
            {
                "id": "lights",
                "name": "Lights",
                "toolId": "Home.lights",
                "isAvailableExternally": true
            },
            {
                "id": "remind",
                "name": "Remind",
                "toolId": "Home.remind",
                "isLlmArgumentParsingEnabled": true,
                "isAvailableExternally": true
            },
            {
                "id": "remind-raw",
                "name": "Remind raw",
                "toolId": "Home.remind",
                "isAvailableExternally": true
            },
            {
                "id": "twin-a",
                "name": "Twin",
                "toolId": "script",
                "toolConfig": { "command": "a" },
                "isAvailableExternally": true
            },
            {
                "id": "twin-b",
                "name": "twin",
                "toolId": "script",
                "toolConfig": { "command": "b" },
                "isAvailableExternally": true
            },
            {
                "id": "twin-c",
                "name": "Twin",
                "toolId": "script",
                "toolConfig": { "command": "c" },
                "isAvailableExternally": false
            },
            {
                "id": "Lamp",
                "name": "Свет",
                "toolId": "webhook",
                "toolConfig": { "url": "https://example.com" },
                "isAvailableExternally": true
            },
            {
                "id": "lamp-2",
                "name": "Lamp",
                "toolId": "webhook",
                "toolConfig": { "url": "https://example.com" },
                "isAvailableExternally": true
            }
        ]
    })
}

fn catalog() -> ToolCatalog {
    let entry = |id: &str, input, available, reason: Option<&str>| ToolCatalogEntry {
        id: id.to_owned(),
        input,
        is_available: available,
        reason: reason.map(str::to_owned),
        input_schema: None,
        command_inputs: HashMap::new(),
    };
    catalog_from(vec![
        entry("script", ToolInputKind::Text, true, None),
        entry("FastNote.write", ToolInputKind::Text, true, None),
        entry(
            "core.translate",
            ToolInputKind::Text,
            false,
            Some("No LLM is configured"),
        ),
        entry("Home.lights", ToolInputKind::None, true, None),
        entry("Home.remind", ToolInputKind::Structured, true, None),
    ])
}

fn find_in(id: &str) -> Result<ExternalCommand, CommandLookupError> {
    find_by_id(&config(), Some(&catalog()), id)
}

fn find_named(name: &str) -> Result<ExternalCommand, CommandLookupError> {
    find_by_name(&config(), Some(&catalog()), name)
}

#[test]
fn configured_input_changes_schema_and_call_capabilities() {
    let command = json!({
        "id": "configured", "toolId": "Plugin.dynamic",
        "toolConfig": {"mode": "structured"}, "isAvailableExternally": true
    });
    let mut tool = ToolCatalogEntry {
        id: "Plugin.dynamic".into(),
        input: ToolInputKind::Text,
        is_available: true,
        reason: None,
        input_schema: None,
        command_inputs: HashMap::new(),
    };
    tool.command_inputs.insert("configured".into(), CommandInputDescription {
        tool_config: command["toolConfig"].clone(), input: ToolInputKind::Structured,
        input_schema: json!({"type":"object", "properties":{"at":{"type":"string"}}, "required":["at"]}),
    });
    assert_eq!(
        command_input(&command, &tool)
            .unwrap()
            .unwrap()
            .input_schema["required"],
        json!(["at"])
    );
    let config = json!({"commands":[command.clone()]});
    let catalog = catalog_from(vec![tool]);
    let found = find_by_id(&config, Some(&catalog), "configured").unwrap();
    assert!(found.has_structured_input);
    assert!(!found.can_take_text);
    let description = describe(&config, Some(&catalog), "configured", false).unwrap();
    assert_eq!(description["inputSchema"]["required"], json!(["at"]));
    assert_eq!(description["textAccepted"], false);
    let listed = list(&config, Some(&catalog));
    assert_eq!(listed[0]["input"], "structured");
    assert_eq!(listed[0]["canReplaceSelection"], false);
    let mut changed = config;
    changed["commands"][0]["toolConfig"]["mode"] = json!("text");
    assert_eq!(
        find_by_id(&changed, Some(&catalog), "configured"),
        Err(CommandLookupError::ToolsLoading("configured".into()))
    );
}

#[test]
fn ids_and_names_do_not_stand_for_each_other() {
    assert_eq!(find_named("Lamp").unwrap().id, "lamp-2");
    assert_eq!(find_in("Lamp").unwrap().id, "Lamp");
    assert_eq!(
        find_in("Бэкап"),
        Err(CommandLookupError::NotFound(String::from("Бэкап")))
    );
}

#[test]
fn normalizes_names() {
    assert_eq!(normalize_name("  Ёлка   ЗАПИСЬ "), "елка запись");
    assert_eq!(normalize_name("\tWork\nNote"), "work note");
}

#[test]
fn finds_a_command_by_its_trimmed_id() {
    let found = find_in(" backup ").unwrap();
    assert_eq!(
        found,
        ExternalCommand {
            id: String::from("backup"),
            can_take_text: false,
            has_structured_input: false,
        }
    );
}

#[test]
fn finds_a_command_by_its_normalized_name() {
    assert_eq!(find_named("бэкап").unwrap().id, "backup");
    let note = find_named("work note").unwrap();
    assert_eq!(note.id, "note");
    assert!(note.can_take_text);
}

#[test]
fn reports_why_a_command_cannot_be_called() {
    assert_eq!(
        find_in("nothing"),
        Err(CommandLookupError::NotFound(String::from("nothing")))
    );
    assert_eq!(
        find_in(""),
        Err(CommandLookupError::NotFound(String::new()))
    );
    assert_eq!(
        find_in("hidden"),
        Err(CommandLookupError::NotExternal(String::from("hidden")))
    );
    assert_eq!(
        find_named("Off"),
        Err(CommandLookupError::Disabled(String::from("off")))
    );
    assert_eq!(
        find_in("missing-tool"),
        Err(CommandLookupError::Unavailable(
            String::from("missing-tool"),
            None
        ))
    );
    assert_eq!(
        find_in("translate"),
        Err(CommandLookupError::Unavailable(
            String::from("translate"),
            Some(String::from("No LLM is configured"))
        ))
    );
    assert!(find_in("remind-raw").unwrap().has_structured_input);
}

#[test]
fn learns_plugin_tools_from_the_catalog() {
    assert_eq!(
        find_by_id(&config(), None, "plugin"),
        Err(CommandLookupError::ToolsLoading(String::from("plugin")))
    );
    // the backend knows its own tools without the catalog
    assert_eq!(find_by_id(&config(), None, "backup").unwrap().id, "backup");
    let note = find_in("plugin").unwrap();
    assert!(note.can_take_text);
    assert!(!find_in("lights").unwrap().can_take_text);
    // the LLM fills the structured input from the text
    assert!(find_in("remind").unwrap().can_take_text);
}

#[test]
fn a_script_takes_the_text_it_mentions() {
    assert!(script_can_take_text(&json!({ "command": "echo {{TEXT}}" })));
    assert!(!script_can_take_text(
        &json!({ "command": "printf %s \"$TYCO_TEXT\"" })
    ));
    assert!(!script_can_take_text(&json!({ "command": "backup.sh" })));
    assert!(!script_can_take_text(&json!({})));
}

#[test]
fn a_webhook_takes_the_text_where_its_placeholder_stands() {
    assert!(webhook_can_take_text(
        &json!({ "url": "https://x.test/?q={{TEXT}}", "method": "GET" })
    ));
    assert!(webhook_can_take_text(&json!({
        "url": "https://x.test",
        "payloadTemplate": "{\"text\": \"{{TEXT}}\"}"
    })));
    // a GET request sends no body
    assert!(!webhook_can_take_text(&json!({
        "url": "https://x.test",
        "method": "GET",
        "payloadTemplate": "{{TEXT}}"
    })));
    assert!(!webhook_can_take_text(&json!({ "url": "https://x.test" })));
}

#[test]
fn accepts_commands_independently_of_launcher_output_settings() {
    let mut catalog = catalog();
    catalog.get_mut("core.translate").unwrap().is_available = true;
    let found = find_by_id(&config(), Some(&catalog), "translate").unwrap();
    assert!(found.can_take_text);
}

#[test]
fn refuses_a_name_shared_by_callable_commands() {
    // twin-c may not be called from outside, so it does not count
    assert_eq!(
        find_named("TWIN"),
        Err(CommandLookupError::Ambiguous(
            String::from("TWIN"),
            vec![String::from("twin-a"), String::from("twin-b")]
        ))
    );
}

#[test]
fn lists_the_callable_commands() {
    let listed = list(&config(), Some(&catalog()));
    assert!(listed
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["canReplaceSelection"].is_boolean()
            && item["output"] == "return"
            && item.get("afterRun").is_none()));
    let essential: Vec<Value> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|item| json!({"id":item["id"],"name":item["name"],"input":item["input"]}))
        .collect();
    assert_eq!(
        json!(essential),
        json!([
            { "id": "backup", "name": "Бэкап", "input": "none" },
            { "id": "note", "name": "Work  Note", "input": "text" },
            { "id": "plugin", "name": "Plugin", "input": "text" },
            { "id": "lights", "name": "Lights", "input": "none" },
            { "id": "remind", "name": "Remind", "input": "structured" },
            { "id": "remind-raw", "name": "Remind raw", "input": "structured" },
            { "id": "twin-a", "name": "Twin", "input": "none" },
            { "id": "twin-b", "name": "twin", "input": "none" },
            { "id": "Lamp", "name": "Свет", "input": "none" },
            { "id": "lamp-2", "name": "Lamp", "input": "none" }
        ])
    );
    assert_eq!(list(&json!({}), None), json!([]));
}

#[test]
fn names_normalize_as_the_webview_does() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../../packages/shared/fixtures/command-names.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let [name, expected] = [&case[0], &case[1]].map(|value| value.as_str().unwrap());
        assert_eq!(normalize_name(name), expected, "{name:?}");
    }
}
