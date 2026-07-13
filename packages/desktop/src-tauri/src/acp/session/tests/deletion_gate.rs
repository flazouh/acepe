//! Deletion gate for `session_converter` removal (clean session ingress Phase 2).

use std::fs;
use std::path::{Path, PathBuf};

use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session::engine::persisted_region::{
    extract_persisted_region, persisted_regions_equal,
};
use crate::acp::session::ingress::providers::cursor::CursorHistorySource;
use crate::acp::session::ingress::source::{HistoryInput, HistorySource};
use crate::acp::session::tests::fixture_jsonl::{
    parse_jsonl_fixture, session_updates_to_provider_events,
};
use crate::acp::session::tests::golden::{load_persisted_golden, GOLDEN_CURSOR_JUNK_NAME};
use crate::acp::session::tests::tool_call_golden::GOLDEN_HISTORICAL_TOOL_CALL_NAME;
use crate::acp::types::CanonicalAgentId;

const ORACLE_CURSOR_HISTORY: &str = "cursor_history_source_fold_matches_phase0_golden";
const ORACLE_HISTORICAL_TOOL_CALL: &str = "fold_full_historical_tool_call_matches_phase0_golden";

const FORBIDDEN_PROVIDER_IMPORTS: &[&str] =
    &["session_converter", "cursor_history", "session_jsonl"];

fn session_tests_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/session/tests")
}

fn oracle_source_path(oracle_name: &str) -> PathBuf {
    let file = match oracle_name {
        ORACLE_CURSOR_HISTORY => "history_fold_oracle.rs",
        ORACLE_HISTORICAL_TOOL_CALL => "tool_call_golden.rs",
        other => panic!("unknown oracle: {other}"),
    };
    session_tests_dir().join(file)
}

fn oracle_is_ignored_elsewhere(oracle_name: &str) -> bool {
    let source = fs::read_to_string(oracle_source_path(oracle_name))
        .unwrap_or_else(|error| panic!("read oracle source for {oracle_name}: {error}"));

    let needle = format!("fn {oracle_name}");
    let fn_pos = source
        .find(&needle)
        .unwrap_or_else(|| panic!("oracle fn {oracle_name} not found in source"));

    let prefix = &source[..fn_pos];
    prefix.contains("#[ignore")
}

async fn run_cursor_history_source_fold_oracle() -> Result<(), String> {
    const SESSION_ID: &str = "c2a34686-f99a-4632-90e2-e036b96124c2";

    let fixture_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");

    let events = CursorHistorySource
        .read(HistoryInput {
            session_id: SESSION_ID.to_string(),
            workspace_root: Some(fixture_dir),
        })
        .await
        .map_err(|error| format!("read cursor junk fixture: {error}"))?;

    if events.is_empty() {
        return Err("HistorySource emitted no events from junk fixture".to_string());
    }

    let ctx = FoldContext::new(
        SESSION_ID,
        CanonicalAgentId::Cursor,
        "/Users/alex/Documents/sandbox",
    );
    let graph = fold_full(&events, &ctx);
    let folded = extract_persisted_region(&graph);
    let golden = load_persisted_golden(GOLDEN_CURSOR_JUNK_NAME);

    if persisted_regions_equal(&folded, &golden) {
        Ok(())
    } else {
        Err("folded persisted region does not match Phase 0 golden".to_string())
    }
}

fn run_fold_full_historical_tool_call_oracle() -> Result<(), String> {
    const SESSION_ID: &str = "sess-hist-001";
    const PROJECT_PATH: &str = "/project";

    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
        "src/acp/session/ingress/tool_identity/tests/fixtures/historical-tool-call-session.jsonl",
    );

    if !fixture_path.exists() {
        return Err(format!("fixture not found: {}", fixture_path.display()));
    }

    let updates = parse_jsonl_fixture(&fixture_path);
    let events = session_updates_to_provider_events(CanonicalAgentId::ClaudeCode, &updates);

    let ctx = FoldContext::new(SESSION_ID, CanonicalAgentId::ClaudeCode, PROJECT_PATH);
    let graph = fold_full(&events, &ctx);
    let folded = extract_persisted_region(&graph);
    let golden = load_persisted_golden(GOLDEN_HISTORICAL_TOOL_CALL_NAME);

    if persisted_regions_equal(&folded, &golden) {
        Ok(())
    } else {
        Err("fold_full persisted region does not match Phase 0 golden".to_string())
    }
}

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("read directory {}: {error}", dir.display()));

    for entry in entries {
        let entry =
            entry.unwrap_or_else(|error| panic!("read dir entry in {}: {error}", dir.display()));
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn session_converter_module_is_deleted() {
    let converter_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/session_converter");
    assert!(
        !converter_dir.exists(),
        "session_converter/ must be deleted once HistorySource + fold own history ingress"
    );

    let lib_rs = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"))
        .expect("read lib.rs");
    assert!(
        !lib_rs.contains("mod session_converter"),
        "lib.rs must not declare mod session_converter"
    );
}

#[test]
fn session_materialization_module_is_deleted() {
    let materialization_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/session_materialization");
    assert!(
        !materialization_dir.exists(),
        "session_materialization/ must be deleted once fold owns provider snapshot materialization"
    );

    let acp_mod =
        fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/mod.rs"))
            .expect("read acp/mod.rs");
    assert!(
        !acp_mod.contains("mod session_materialization"),
        "acp/mod.rs must not declare mod session_materialization"
    );
}

#[tokio::test]
async fn all_phase0_golden_oracles_are_green() {
    let oracles = [ORACLE_CURSOR_HISTORY, ORACLE_HISTORICAL_TOOL_CALL];

    let mut ignored = Vec::new();
    let mut failing = Vec::new();

    for oracle in oracles {
        if oracle_is_ignored_elsewhere(oracle) {
            ignored.push(oracle);
        }

        let result = match oracle {
            ORACLE_CURSOR_HISTORY => run_cursor_history_source_fold_oracle().await,
            ORACLE_HISTORICAL_TOOL_CALL => run_fold_full_historical_tool_call_oracle(),
            other => panic!("unhandled oracle: {other}"),
        };

        if let Err(reason) = result {
            failing.push(format!("{oracle}: {reason}"));
        }
    }

    if ignored.is_empty() && failing.is_empty() {
        return;
    }

    let mut message = String::from(
        "session_converter deletion blocked: Phase 0 golden oracles are not all green.\n",
    );

    if !ignored.is_empty() {
        message.push_str("\nStill #[ignore] elsewhere:\n");
        for oracle in &ignored {
            message.push_str(&format!("  - {oracle}\n"));
        }
    }

    if !failing.is_empty() {
        message.push_str("\nFailing oracle logic:\n");
        for failure in &failing {
            message.push_str(&format!("  - {failure}\n"));
        }
    }

    panic!("{message}");
}

#[test]
fn engine_and_delivery_have_no_provider_imports() {
    let session_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/session");

    let mut violations = Vec::new();

    for subdir in ["engine", "delivery"] {
        let dir = session_dir.join(subdir);
        if !dir.exists() {
            continue;
        }

        let mut files = Vec::new();
        collect_rs_files(&dir, &mut files);

        for path in files {
            let path_str = path.to_string_lossy();
            if path_str.contains("/acp/session/delivery/export/") {
                continue;
            }

            let contents = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));

            for forbidden in FORBIDDEN_PROVIDER_IMPORTS {
                if contents.contains(forbidden) {
                    violations.push(format!(
                        "{} contains forbidden string `{forbidden}`",
                        path.display()
                    ));
                }
            }
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "engine/ and delivery/ must stay provider-agnostic before session_converter deletion.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn provider_history_modules_are_under_ingress_providers() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let legacy_roots = [
        manifest_dir.join("src/session_jsonl"),
        manifest_dir.join("src/copilot_history"),
        manifest_dir.join("src/codex_history"),
        manifest_dir.join("src/opencode_history"),
        manifest_dir.join("src/cursor_history"),
        manifest_dir.join("src/history/cursor_sqlite_parser.rs"),
    ];

    for path in legacy_roots {
        assert!(
            !path.exists(),
            "legacy provider module {} must be moved under acp/session/ingress/providers/",
            path.display()
        );
    }

    let lib_rs = fs::read_to_string(manifest_dir.join("src/lib.rs")).expect("read lib.rs");
    assert!(
        lib_rs.contains("pub use acp::session::ingress::providers::claude_code::session_jsonl"),
        "lib.rs must re-export session_jsonl from ingress/providers"
    );
    assert!(
        lib_rs.contains("pub use acp::session::ingress::providers::opencode::opencode_history"),
        "lib.rs must re-export opencode_history from ingress/providers"
    );
    assert!(
        lib_rs.contains("pub use acp::session::ingress::providers::cursor::cursor_history"),
        "lib.rs must re-export cursor_history from ingress/providers"
    );
}

#[test]
fn stored_entry_is_confined_to_export_and_ingress_paths() {
    let src_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    collect_rs_files(&src_dir, &mut files);

    let allowed_substrings = [
        "/acp/session/delivery/export/",
        "/acp/session/fold_export.rs",
        "/acp/session/ingress/",
        "/acp/session/tests/",
        "/acp/session_open_snapshot/",
        "/acp/transcript_projection/",
        "/acp/parsers/",
        "/acp/projections/",
        "/acp/session_thread_snapshot.rs",
        "/acp/session_restore/",
        "/acp/session_update/",
        "/acp/commands/",
        "/acp/transcript_viewport/",
        "/history/",
    ];

    let mut violations = Vec::new();
    for path in files {
        let path_str = path.to_string_lossy();
        if allowed_substrings
            .iter()
            .any(|allowed| path_str.contains(allowed))
        {
            continue;
        }

        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        if contents.contains("StoredEntry") {
            violations.push(path.display().to_string());
        }
    }

    if violations.is_empty() {
        // MIGRATION DONE: StoredEntry is confined to export/ingress compat paths above.
        return;
    }

    panic!(
        "StoredEntry must stay on export/ingress compat paths (Phase 4 compat-only remainder).\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn fold_spine_has_no_materialize_provider_owned_imports() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let paths = [
        manifest_dir.join("src/acp/session/fold_export.rs"),
        manifest_dir.join("src/acp/transcript_viewport/ledger_rebuild.rs"),
    ];

    let mut violations = Vec::new();
    for path in paths {
        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        if contents.contains("materialize_provider_owned_thread_snapshot") {
            violations.push(format!(
                "{} must not call materialize_provider_owned_thread_snapshot",
                path.display()
            ));
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "fold spine must not depend on session_materialization repair.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// Phase 4 compat-only remainder gate (MIGRATION DONE).
///
/// Core ingress migration is structurally complete: all five providers load history
/// via `HistorySource` → `fold_full`, and live transcript updates route through
/// `delivery/live_transcript_fold`. `session_converter` and
/// `session_materialization` are deleted.
///
/// Remaining `SessionThreadSnapshot` / `StoredEntry` usage is compat-only:
/// - `session_thread_snapshot.rs` — type definition + provider-owned snapshot envelope
/// - `session/fold_export.rs` — fold graph → backward-compat snapshot mapper
/// - `session/delivery/export/` — one-way fold → StoredEntry export projection
/// - `session/ingress/providers/{copilot,codex}/disk.rs` — fold-first disk re-exports only
/// - `session/ingress/stored_entry_events.rs` — shared StoredEntry → ProviderEvent mapper
/// - `session_open_snapshot/snapshot.rs` — fold-first materialize compat hydration
/// - `session_restore/fold_audit.rs` — fold-first history load for CLI timing audit
/// - `session_restore/timing_audit.rs` — audit harness (OpenCode disk path uses fold-first)
/// - `transcript_viewport/ledger_rebuild.rs` — ledger rebuild from compat snapshot
/// - `opencode_history/{parser,commands}.rs` — session list/index + HTTP fetch commands
///   (disk ingress is `load_opencode_messages_from_disk` + fold; now nested under
///   `session/ingress/providers/opencode/`)
/// - `cursor_history/{parser,commands}.rs` — session list/index + workspace discovery
///   (disk ingress is `parse_cursor_store_db` + fold; now nested under
///   `session/ingress/providers/cursor/`)
/// - `providers/*/provider.rs` — provider history load return type at fold export boundary
/// - `history/commands/scanning.rs` — session index title derivation via compat snapshot
///   → `TranscriptSnapshot` (no direct `StoredEntry` pattern match in production code)
/// - `acp/session/tests/*` — golden oracles and conformance fixtures
#[test]
fn migration_phase4_compat_paths_are_narrow() {
    let src_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    collect_rs_files(&src_dir, &mut files);

    let allowed_substrings = [
        "/acp/session_thread_snapshot.rs",
        "/acp/session/fold_export.rs",
        "/acp/session_restore/",
        "/acp/session_open_snapshot/",
        "/acp/session/ingress/providers/",
        "/acp/session/tests/",
        "/acp/providers/",
        "/acp/transcript_viewport/",
        "/acp/projections/",
        "/acp/commands/",
        "/history/",
    ];

    let mut violations = Vec::new();
    for path in files {
        let path_str = path.to_string_lossy();
        if allowed_substrings
            .iter()
            .any(|allowed| path_str.contains(allowed))
        {
            continue;
        }

        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        if contents.contains("SessionThreadSnapshot") {
            violations.push(path.display().to_string());
        }
    }

    if violations.is_empty() {
        // MIGRATION DONE: SessionThreadSnapshot is confined to Phase 4 compat paths above.
        return;
    }

    panic!(
        "SessionThreadSnapshot leaked outside Phase 4 compat allowlist.\n\
         See migration_phase4_compat_paths_are_narrow doc comment for allowed remainder.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn history_source_read_skips_session_thread_snapshot_wrappers() {
    let ingress_root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/session/ingress/providers");
    let provider_modules = [
        "claude_code/mod.rs",
        "cursor/mod.rs",
        "copilot/mod.rs",
        "codex/mod.rs",
        "opencode/mod.rs",
    ];

    let forbidden = [
        "SessionThreadSnapshot",
        "load_thread_snapshot",
        "convert_replay_updates_to_session",
        "parse_copilot_session_at_root",
    ];

    for module in provider_modules {
        let path = ingress_root.join(module);
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        let read_body = extract_history_source_read_body(&source)
            .unwrap_or_else(|| panic!("HistorySource::read not found in {}", path.display()));

        for needle in forbidden {
            assert!(
                !read_body.contains(needle),
                "{} HistorySource::read must not use compat snapshot wrapper `{needle}`",
                path.display()
            );
        }
        assert!(
            read_body.contains("ProviderEvent"),
            "{} HistorySource::read must emit ProviderEvent directly",
            path.display()
        );
    }
}

#[test]
fn ingress_tool_table_imports_tool_identity_alias() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/session/ingress/tool_table.rs");
    let source = fs::read_to_string(&path).expect("read tool_table.rs");

    assert!(
        source.contains("crate::acp::session::ingress::tool_identity"),
        "tool_table must import through tool_identity alias"
    );
    assert!(
        !source.contains("crate::acp::reconciler::"),
        "tool_table must not import reconciler directly after alias migration"
    );
}

#[test]
fn parsers_import_tool_identity_alias() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let paths = [
        manifest_dir.join("src/acp/parsers/mod.rs"),
        manifest_dir.join("src/acp/parsers/codex_parser.rs"),
        manifest_dir.join("src/acp/parsers/copilot_parser.rs"),
        manifest_dir.join("src/acp/parsers/cursor_parser.rs"),
        manifest_dir.join("src/acp/parsers/claude_code_parser.rs"),
        manifest_dir.join("src/acp/parsers/types.rs"),
    ];

    for path in paths {
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        if path.ends_with("mod.rs") {
            assert!(
                source.contains("crate::acp::session::ingress::tool_identity"),
                "{} must re-export adapters through tool_identity",
                path.display()
            );
        } else {
            assert!(
                source.contains("crate::acp::session::ingress::tool_identity"),
                "{} must import through tool_identity",
                path.display()
            );
        }
        assert!(
            !source.contains("crate::acp::reconciler::"),
            "{} must not import reconciler directly",
            path.display()
        );
    }
}

#[test]
fn streaming_accumulator_imports_tool_identity_alias() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/acp/streaming_accumulator/tool_streaming.rs");
    let source = fs::read_to_string(&path).expect("read tool_streaming.rs");

    assert!(
        source.contains("crate::acp::session::ingress::tool_identity"),
        "tool_streaming must import through tool_identity"
    );
    assert!(
        !source.contains("crate::acp::reconciler::"),
        "tool_streaming must not import reconciler directly"
    );
}

#[test]
fn inbound_request_router_imports_tool_identity_alias() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let paths = [
        manifest_dir.join("src/acp/inbound_request_router/helpers.rs"),
        manifest_dir.join("src/acp/inbound_request_router/permission_handlers.rs"),
    ];

    for path in paths {
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        assert!(
            source.contains("crate::acp::session::ingress::tool_identity"),
            "{} must import through tool_identity",
            path.display()
        );
        assert!(
            !source.contains("crate::acp::reconciler::"),
            "{} must not import reconciler directly",
            path.display()
        );
    }
}

#[test]
fn all_provider_history_loads_use_fold_graph() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let provider_modules = [
        "claude_code/provider.rs",
        "cursor/provider.rs",
        "copilot/provider.rs",
        "codex/provider.rs",
        "opencode/provider.rs",
    ];

    let mut violations = Vec::new();
    for module in provider_modules {
        let path = manifest_dir.join("src/acp/providers").join(module);
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));

        if !source.contains("load_fold_graph_from_history") {
            violations.push(format!(
                "{} must load history via load_fold_graph_from_history",
                path.display()
            ));
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "All five providers must route history load through fold graph ingress.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn ingress_provider_disk_modules_are_fold_first() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let cases = [
        (
            "codex/disk.rs",
            "load_provider_events",
            "load_thread_snapshot",
        ),
        (
            "copilot/disk.rs",
            "load_provider_events_from_disk",
            "load_thread_snapshot",
        ),
        (
            "opencode/disk.rs",
            "load_opencode_messages_from_disk",
            "load_thread_snapshot",
        ),
    ];

    let mut violations = Vec::new();
    for (relative_path, required_export, forbidden_export) in cases {
        let path = manifest_dir
            .join("src/acp/session/ingress/providers")
            .join(relative_path);
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));

        if !source.contains(required_export) {
            violations.push(format!(
                "{relative_path} must re-export {required_export} for fold-first ingress"
            ));
        }

        let re_exports_compat = source
            .lines()
            .map(str::trim_start)
            .filter(|line| line.starts_with("pub use"))
            .any(|line| line.contains(forbidden_export));
        if re_exports_compat {
            violations.push(format!(
                "{relative_path} must not re-export compat {forbidden_export}"
            ));
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "Provider disk modules must expose fold-first ingress loaders only.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn compat_thread_snapshot_disk_loaders_are_deleted() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let forbidden_pub_fns = [
        (
            "src/acp/session/ingress/providers/codex/codex_history/parser.rs",
            "pub async fn load_thread_snapshot",
        ),
        (
            "src/acp/session/ingress/providers/copilot/copilot_history/mod.rs",
            "pub async fn load_thread_snapshot_from_disk",
        ),
        (
            "src/acp/session/ingress/providers/copilot/copilot_history/mod.rs",
            "pub async fn load_thread_snapshot",
        ),
        (
            "src/acp/session/ingress/providers/opencode/opencode_history/parser.rs",
            "pub async fn load_session_from_disk",
        ),
        (
            "src/acp/session/ingress/providers/opencode/opencode_history/parser.rs",
            "pub async fn load_thread_snapshot_from_disk",
        ),
        (
            "src/acp/session/ingress/providers/opencode/opencode_history/parser.rs",
            "pub async fn load_provider_owned_snapshot_from_disk",
        ),
    ];

    let mut violations = Vec::new();
    for (relative_path, fn_marker) in forbidden_pub_fns {
        let path = manifest_dir.join(relative_path);
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        if source.contains(fn_marker) {
            violations.push(format!(
                "{relative_path} must delete compat loader `{fn_marker}`"
            ));
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "Compat SessionThreadSnapshot disk loaders must be deleted once fold ingress owns disk replay.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn session_restore_avoids_compat_disk_loaders() {
    let restore_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/session_restore");
    let forbidden = [
        "load_session_from_disk",
        "load_thread_snapshot_from_disk",
        "load_thread_snapshot(",
        "load_provider_owned_snapshot_from_disk",
    ];

    let mut files = Vec::new();
    collect_rs_files(&restore_dir, &mut files);

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        for needle in forbidden {
            if contents.contains(needle) {
                violations.push(format!(
                    "{} must not call compat disk loader `{needle}`",
                    path.display()
                ));
            }
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "session_restore must route disk history through fold_audit / HistorySource ingress.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn opencode_commands_try_fold_first_disk_load() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/acp/session/ingress/providers/opencode/opencode_history/commands.rs");
    let source = fs::read_to_string(&path).expect("read opencode commands.rs");

    assert!(
        source.contains("load_materialized_from_history"),
        "opencode commands must try fold-first materialized disk load before HTTP fallback"
    );
    assert!(
        !source.contains("load_session_from_disk"),
        "opencode commands must not call deleted compat load_session_from_disk"
    );
}

#[test]
fn projections_module_documents_tool_identity_authority() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/projections/mod.rs");
    let source = fs::read_to_string(&path).expect("read projections/mod.rs");

    assert!(
        source.contains("crate::acp::session::ingress::tool_identity"),
        "projections mod docs must reference tool_identity as classification authority"
    );
    assert!(
        !source.contains("crate::acp::reconciler::projector"),
        "projections mod docs must not reference reconciler::projector directly"
    );
}

#[test]
fn projections_expose_stored_entry_import_path() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/projections/session_lifecycle.rs");
    let source = fs::read_to_string(&path).expect("read session_lifecycle.rs");

    assert!(
        source.contains("pub fn project_stored_entries"),
        "projections must expose fold/export-friendly StoredEntry import path"
    );
    assert!(
        source.contains("import_stored_entries"),
        "projections registry must import from StoredEntry slice"
    );
}

#[test]
fn session_restore_audit_paths_avoid_session_thread_snapshot() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let paths = [
        "src/acp/session_restore/fold_audit.rs",
        "src/acp/session_restore/timing_audit.rs",
        "src/acp/session_restore/tool_link_audit.rs",
    ];
    let forbidden = [
        "SessionThreadSnapshot",
        "session_thread_snapshot_from_materialized",
        "project_thread_snapshot",
    ];

    let mut violations = Vec::new();
    for relative_path in paths {
        let path = manifest_dir.join(relative_path);
        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        for needle in forbidden {
            if contents.contains(needle) {
                violations.push(format!(
                    "{relative_path} must not depend on compat SessionThreadSnapshot path `{needle}`"
                ));
            }
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "session_restore fold audit paths must use MaterializedThreadSnapshot / StoredEntry ingress.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn fold_export_has_no_thread_snapshot_shortcut_helpers() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/session/fold_export.rs");
    let source = fs::read_to_string(&path).expect("read fold_export.rs");

    let forbidden = [
        "pub fn thread_snapshot_from_history_events",
        "pub fn thread_snapshot_from_full_session",
        "#[deprecated",
    ];

    let mut violations = Vec::new();
    for needle in forbidden {
        if source.contains(needle) {
            violations.push(format!("fold_export.rs must not contain `{needle}`"));
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "fold_export must use materialized helpers only; delete compat shortcuts instead of deprecating.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

fn walk_rs_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir).unwrap_or_else(|error| {
        panic!("read_dir {}: {error}", dir.display());
    });
    for entry in entries {
        let entry = entry.unwrap_or_else(|error| {
            panic!("read_dir entry in {}: {error}", dir.display());
        });
        let path = entry.path();
        if path.is_dir() {
            walk_rs_files(&path, files);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            files.push(path);
        }
    }
}

#[test]
fn session_thread_snapshot_from_materialized_confined_to_fold_export() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src_root = manifest_dir.join("src");
    let allowed = manifest_dir.join("src/acp/session/fold_export.rs");
    let needle = "::session_thread_snapshot_from_materialized(";

    let mut rs_files = Vec::new();
    walk_rs_files(&src_root, &mut rs_files);

    let mut violations = Vec::new();
    for path in rs_files {
        if path == allowed {
            continue;
        }
        if path
            .file_name()
            .is_some_and(|name| name == "deletion_gate.rs")
        {
            continue;
        }
        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        if contents.contains(needle) {
            violations.push(format!(
                "{} must not call `{needle}` outside fold_export export boundary",
                path.strip_prefix(&manifest_dir).unwrap_or(&path).display()
            ));
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "session_thread_snapshot_from_materialized is export-boundary only.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn materialized_from_stored_entries_confined_to_fold_export() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src_root = manifest_dir.join("src");
    let allowed = manifest_dir.join("src/acp/session/fold_export.rs");
    let needle = "materialized_from_stored_entries(";

    let mut rs_files = Vec::new();
    walk_rs_files(&src_root, &mut rs_files);

    let mut violations = Vec::new();
    for path in rs_files {
        if path == allowed {
            continue;
        }
        if path
            .file_name()
            .is_some_and(|name| name == "deletion_gate.rs")
        {
            continue;
        }
        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        if contents.contains(needle) {
            violations.push(format!(
                "{} must not call `{needle}`; use fold ingress instead",
                path.strip_prefix(&manifest_dir).unwrap_or(&path).display()
            ));
        }
    }

    if violations.is_empty() {
        return;
    }

    panic!(
        "materialized_from_stored_entries is fold-export compat only.\n{}",
        violations
            .iter()
            .map(|line| format!("  - {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

fn extract_history_source_read_body(source: &str) -> Option<String> {
    let marker = "impl HistorySource for";
    let start = source.find(marker)?;
    let tail = &source[start..];
    let read_marker = "fn read(";
    let read_start = tail.find(read_marker)?;
    let read_tail = &tail[read_start..];
    let open_brace = read_tail.find('{')?;
    let mut depth = 0usize;
    let mut end = None;
    for (offset, ch) in read_tail[open_brace..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    end = Some(open_brace + offset + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    end.map(|end| read_tail[..end].to_string())
}
