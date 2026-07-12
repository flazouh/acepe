//! Phase 2 tool-call session golden oracle.

pub const GOLDEN_HISTORICAL_TOOL_CALL_NAME: &str = "historical_tool_call";

use std::path::PathBuf;

use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session::engine::persisted_region::{
    extract_persisted_region, persisted_regions_equal,
};
use crate::acp::session::tests::fixture_jsonl::{
    parse_jsonl_fixture, session_updates_to_provider_events,
};
use crate::acp::session::tests::golden::{
    golden_fixture_dir, load_persisted_golden, write_persisted_golden,
};
use crate::acp::types::CanonicalAgentId;

const SESSION_ID: &str = "sess-hist-001";
const PROJECT_PATH: &str = "/project";

fn historical_tool_call_fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/acp/reconciler/tests/fixtures/historical-tool-call-session.jsonl")
}

fn should_update_goldens() -> bool {
    std::env::var("ACEPE_UPDATE_GOLDENS")
        .ok()
        .is_some_and(|value| value == "1")
}

fn folded_graph_from_fixture() -> crate::acp::session_state_engine::graph::SessionStateGraph {
    let fixture_path = historical_tool_call_fixture_path();
    assert!(
        fixture_path.exists(),
        "fixture not found: {}",
        fixture_path.display()
    );

    let updates = parse_jsonl_fixture(&fixture_path);
    let events = session_updates_to_provider_events(CanonicalAgentId::ClaudeCode, &updates);
    let ctx = FoldContext::new(SESSION_ID, CanonicalAgentId::ClaudeCode, PROJECT_PATH);
    fold_full(&events, &ctx)
}

#[test]
fn historical_tool_call_persisted_golden_matches_fold_path() {
    let graph = folded_graph_from_fixture();
    let current = extract_persisted_region(&graph);
    let golden_path = golden_fixture_dir().join(format!("{GOLDEN_HISTORICAL_TOOL_CALL_NAME}.json"));

    if !golden_path.exists() || should_update_goldens() {
        write_persisted_golden(GOLDEN_HISTORICAL_TOOL_CALL_NAME, &graph);
        return;
    }

    let expected = load_persisted_golden(GOLDEN_HISTORICAL_TOOL_CALL_NAME);
    assert!(
        persisted_regions_equal(&current, &expected),
        "persisted session graph mismatch for {GOLDEN_HISTORICAL_TOOL_CALL_NAME}"
    );
}

#[test]
fn fold_full_historical_tool_call_matches_phase0_golden() {
    let graph = folded_graph_from_fixture();
    let folded = extract_persisted_region(&graph);
    let golden = load_persisted_golden(GOLDEN_HISTORICAL_TOOL_CALL_NAME);

    assert!(
        persisted_regions_equal(&folded, &golden),
        "fold_full must match Phase 0 golden before history cutover"
    );
}
