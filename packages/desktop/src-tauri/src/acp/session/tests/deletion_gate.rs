//! Behavioral and filesystem deletion gates for the clean session ingress.

use std::path::PathBuf;

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

#[test]
fn session_converter_module_is_deleted() {
    let converter_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/session_converter");
    assert!(
        !converter_dir.exists(),
        "session_converter/ must be deleted once HistorySource + fold own history ingress"
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
}

#[tokio::test]
async fn all_phase0_golden_oracles_are_green() {
    let cursor_result = run_cursor_history_source_fold_oracle().await;
    let historical_tool_result = run_fold_full_historical_tool_call_oracle();

    let mut failures = Vec::new();
    if let Err(reason) = cursor_result {
        failures.push(format!(
            "cursor_history_source_fold_matches_phase0_golden: {reason}"
        ));
    }
    if let Err(reason) = historical_tool_result {
        failures.push(format!(
            "fold_full_historical_tool_call_matches_phase0_golden: {reason}"
        ));
    }

    assert!(
        failures.is_empty(),
        "session ingress golden oracles failed:\n{}",
        failures.join("\n")
    );
}

#[test]
fn legacy_provider_history_modules_are_deleted() {
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
}
