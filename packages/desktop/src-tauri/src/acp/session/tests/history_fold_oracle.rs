//! HistorySource → fold_full integration oracle (Phase 2 gate).

use crate::acp::session::delivery::{graph_from_history_events, session_open_found_from_fold};
use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session::engine::persisted_region::{
    extract_persisted_region, persisted_regions_equal,
};
use crate::acp::session::ingress::providers::claude_code::ClaudeHistorySource;
use crate::acp::session::ingress::providers::cursor::CursorHistorySource;
use crate::acp::session::ingress::source::{HistoryInput, HistorySource};
use crate::acp::session::tests::golden::{load_persisted_golden, GOLDEN_CURSOR_JUNK_NAME};
use crate::acp::session::tests::tool_call_golden::GOLDEN_HISTORICAL_TOOL_CALL_NAME;
use crate::acp::session_open_snapshot::SessionOpenPath;
use crate::acp::types::CanonicalAgentId;
use std::path::PathBuf;

#[tokio::test]
async fn cursor_history_source_fold_matches_phase0_golden() {
    const SESSION_ID: &str = "c2a34686-f99a-4632-90e2-e036b96124c2";

    let fixture_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");

    let events = CursorHistorySource
        .read(HistoryInput {
            session_id: SESSION_ID.to_string(),
            workspace_root: Some(fixture_dir),
        })
        .await
        .expect("read cursor junk fixture");

    assert!(
        !events.is_empty(),
        "HistorySource must emit events from junk fixture"
    );

    let ctx = FoldContext::new(
        SESSION_ID,
        CanonicalAgentId::Cursor,
        "/Users/alex/Documents/sandbox",
    );
    let graph = fold_full(&events, &ctx);
    let folded = extract_persisted_region(&graph);
    let golden = load_persisted_golden(GOLDEN_CURSOR_JUNK_NAME);

    assert!(
        persisted_regions_equal(&folded, &golden),
        "HistorySource + fold_full must match Phase 0 golden before converter deletion"
    );
}

#[tokio::test]
async fn cursor_history_source_open_from_fold_matches_phase0_golden() {
    const SESSION_ID: &str = "c2a34686-f99a-4632-90e2-e036b96124c2";

    let fixture_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");

    let events = CursorHistorySource
        .read(HistoryInput {
            session_id: SESSION_ID.to_string(),
            workspace_root: Some(fixture_dir),
        })
        .await
        .expect("read cursor junk fixture");

    let ctx = FoldContext::new(
        SESSION_ID,
        CanonicalAgentId::Cursor,
        "/Users/alex/Documents/sandbox",
    );
    let graph = graph_from_history_events(&events, &ctx);
    let found = session_open_found_from_fold(graph, "test-open-token");
    let golden = load_persisted_golden(GOLDEN_CURSOR_JUNK_NAME);

    assert_eq!(
        found.transcript_snapshot.entries, golden.transcript_snapshot.entries,
        "HistorySource + open_from_fold transcript entries must match Phase 0 golden"
    );
    assert_eq!(
        found.operations.len(),
        golden.operations.len(),
        "HistorySource + open_from_fold operation count must match Phase 0 golden"
    );
    assert_eq!(
        found.open_path,
        SessionOpenPath::FoldHistory,
        "fold-first open_from_fold must report FoldHistory open path"
    );
}

#[tokio::test]
async fn claude_history_source_fold_matches_phase0_golden() {
    const SESSION_ID: &str = "sess-hist-001";

    let fixture_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/acp/session/ingress/tool_identity/tests/fixtures");

    let events = ClaudeHistorySource
        .read(HistoryInput {
            session_id: SESSION_ID.to_string(),
            workspace_root: Some(fixture_dir),
        })
        .await
        .expect("read claude tool-call fixture");

    assert!(
        !events.is_empty(),
        "HistorySource must emit events from tool-call fixture"
    );

    let ctx = FoldContext::new(SESSION_ID, CanonicalAgentId::ClaudeCode, "/project");
    let graph = fold_full(&events, &ctx);
    let folded = extract_persisted_region(&graph);
    let golden = load_persisted_golden(GOLDEN_HISTORICAL_TOOL_CALL_NAME);

    assert!(
        persisted_regions_equal(&folded, &golden),
        "Claude HistorySource + fold_full must match Phase 0 golden before converter deletion"
    );
}
