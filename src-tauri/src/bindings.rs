//! The TypeScript declarations of everything that crosses the IPC boundary:
//! the payloads of the commands and events, and the error codes.
//!
//! `pnpm generate:desktop` has this test write them to `TYCO_BINDINGS_OUT`,
//! formats them into `@tyco/shared` with the hash of what was written, and
//! builds the command signatures on them. Without the variable the test
//! fails while that hash is stale.

use std::any::TypeId;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use sha2::{Digest, Sha256};
use ts_rs::{Config, TypeVisitor, TS};

use crate::errors::{ErrorCode, ErrorPayload};

const OUTPUT: &str = "../packages/shared/src/generated/desktop-types.ts";
/// The line of the formatted file that names the hash of the raw bindings.
const HASH_PREFIX: &str = "// Source hash: ";

/// Types the bindings refer to by name but that are declared on the
/// TypeScript side: what the backend keeps as opaque JSON.
const IMPORTS: &str = "\
import type { PluginManifest } from '@tyco/plugin-sdk'
import type { ChatMessagePart } from '../desktop/chat'
import type { UserConfig } from '../user-config'
";

struct Declarations<'a> {
    cfg: &'a Config,
    seen: HashSet<TypeId>,
    by_name: BTreeMap<String, String>,
}

impl TypeVisitor for Declarations<'_> {
    fn visit<T: TS + 'static + ?Sized>(&mut self) {
        let is_declared = T::output_path().is_some();
        if is_declared && !self.seen.insert(TypeId::of::<T>()) {
            return;
        }
        if is_declared {
            let mut declaration = T::docs().unwrap_or_default();
            declaration.push_str("export ");
            declaration.push_str(&T::decl(self.cfg));
            let name = T::ident(self.cfg);
            if let Some(previous) = self.by_name.insert(name.clone(), declaration.clone()) {
                assert_eq!(
                    previous, declaration,
                    "two Rust types are named {name} in TypeScript"
                );
            }
        }
        T::visit_dependencies(self);
    }
}

/// Every type a command takes or returns; the rest is reached from these.
fn visit_command_types(visitor: &mut impl TypeVisitor) {
    use crate::commands;
    use crate::models;
    use crate::services;

    visitor.visit::<ErrorPayload>();
    visitor.visit::<crate::ipc::SessionStatePatch>();
    visitor.visit::<commands::action_logs::ClientLogLevel>();
    visitor.visit::<commands::ai_files::AiUploadMeta>();
    visitor.visit::<commands::chat_images::ChatImageMeta>();
    visitor.visit::<commands::net::SocketFrameMeta>();
    visitor.visit::<commands::plugins::PluginPackagePreview>();
    visitor.visit::<commands::script_actions::ScriptActionRequest>();
    visitor.visit::<models::Chat>();
    visitor.visit::<models::ChatAttachment>();
    visitor.visit::<models::ChatImage>();
    visitor.visit::<models::ChatSummary>();
    visitor.visit::<models::EditorHistoryEntry>();
    visitor.visit::<models::DesktopSnapshot>();
    visitor.visit::<models::EditorHistoryItem>();
    visitor.visit::<models::SessionState>();
    visitor.visit::<models::StorageInfo>();
    visitor.visit::<models::StorageKind>();
    visitor.visit::<services::activation::ActivationMode>();
    visitor.visit::<services::activation::metrics::ActivationMetricMark>();
    visitor.visit::<services::ai_tools::files::AiFileChangePreview>();
    visitor.visit::<services::ai_tools::files::AiFileRoot>();
    visitor.visit::<services::ai_tools::files::AiFileToolOutput>();
    visitor.visit::<services::ai_tools::files::AiFileToolRequest>();
    visitor.visit::<services::ai_vault::AiProfile>();
    visitor.visit::<services::ai_vault::AiProject>();
    visitor.visit::<services::custom_actions::CommandRunRecord>();
    visitor.visit::<services::custom_actions::ScriptExecutionResult>();
    visitor.visit::<services::external::access::AccessDecision>();
    visitor.visit::<services::external::api::JobCompletion>();
    visitor.visit::<services::external::command_library::ToolCatalogEntry>();
    visitor.visit::<services::hotkeys::HotkeyApplyRequest>();
    visitor.visit::<services::hotkeys::HotkeyApplyResult>();
    visitor.visit::<services::hotkeys::HotkeyProviderInfo>();
    visitor.visit::<services::net::http::FetchEvent>();
    visitor.visit::<services::net::http::FetchRequest>();
    visitor.visit::<services::net::socket::SocketEvent>();
    visitor.visit::<services::net::socket::SocketRequest>();
    visitor.visit::<services::platform::InputRegion>();
    visitor.visit::<services::plugins::InstalledPlugin>();
    visitor.visit::<services::secrets::SecretStatus>();
    visitor.visit::<services::secrets::VaultState>();
    visitor.visit::<services::selection_replace::SelectionFinishStatus>();
    visitor.visit::<services::status_overlay::StatusOverlayRequest>();
    visitor.visit::<services::voice::CaptureEvent>();
    visitor.visit::<services::voice::VoiceCaptureInfo>();
    visitor.visit::<tyco_activation_protocol::Job>();
}

fn render() -> String {
    let cfg = Config::new().with_large_int("number");
    let mut declarations = Declarations {
        cfg: &cfg,
        seen: HashSet::new(),
        by_name: BTreeMap::new(),
    };
    visit_command_types(&mut declarations);
    crate::events::visit_payloads(&mut declarations);

    let mut out = String::from(IMPORTS);
    for declaration in declarations.by_name.values() {
        out.push('\n');
        out.push_str(declaration);
        out.push('\n');
    }

    out.push_str("\n/** Every code a failed desktop command reports. */\n");
    out.push_str("export const DESKTOP_ERROR_CODES = [\n");
    for code in ErrorCode::ALL {
        out.push_str(&format!("  {},\n", serde_json::to_string(code).unwrap()));
    }
    out.push_str("] as const satisfies readonly DesktopErrorCode[]\n");

    out.push_str("\n/** The payload of every event the backend sends to the webviews. */\n");
    out.push_str("export interface DesktopEventPayloads {\n");
    for (name, payload) in crate::events::typescript_payloads(&cfg) {
        out.push_str(&format!("  '{name}': {payload}\n"));
    }
    out.push_str("}\n");
    out
}

#[test]
fn bindings_are_current() {
    let rendered = render();
    if let Ok(out) = std::env::var("TYCO_BINDINGS_OUT") {
        std::fs::write(out, rendered).unwrap();
        return;
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(OUTPUT);
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    let hash = format!("{:x}", Sha256::digest(rendered.as_bytes()));
    assert!(
        current
            .lines()
            .any(|line| line == format!("{HASH_PREFIX}{hash}")),
        "{} is stale; run pnpm generate:desktop",
        path.display()
    );
}
