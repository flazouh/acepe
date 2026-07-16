//! Golden `SessionGraph` persisted-region fixtures (plan 2026-07-12 Phase 0).

pub const GOLDEN_CURSOR_JUNK_NAME: &str = "cursor_c2a34686_junk";

use std::fs;
use std::path::PathBuf;

use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session::engine::persisted_region::{
    extract_persisted_region, PersistedSessionGraph,
};
use crate::acp::session::ingress::providers::cursor::CursorHistorySource;
use crate::acp::session::ingress::source::{HistoryInput, HistorySource};
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::types::CanonicalAgentId;

pub fn golden_fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session_graph_goldens")
}

pub fn write_persisted_golden(name: &str, graph: &SessionStateGraph) {
    let dir = golden_fixture_dir();
    fs::create_dir_all(&dir).expect("create golden fixture directory");
    let path = dir.join(format!("{name}.json"));
    let persisted = extract_persisted_region(graph);
    let json = serde_json::to_string_pretty(&persisted).expect("serialize persisted session graph");
    fs::write(path, json).expect("write golden fixture");
}

pub fn load_persisted_golden(name: &str) -> PersistedSessionGraph {
    let path = golden_fixture_dir().join(format!("{name}.json"));
    let contents = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("golden fixture missing at {}: {error}", path.display()));
    serde_json::from_str(&contents).expect("deserialize golden fixture")
}

fn persisted_json(persisted: &PersistedSessionGraph) -> String {
    serde_json::to_string_pretty(persisted).expect("serialize persisted session graph")
}

fn should_update_goldens() -> bool {
    std::env::var("ACEPE_UPDATE_GOLDENS")
        .ok()
        .is_some_and(|value| value == "1")
}

#[test]
fn cursor_junk_session_persisted_golden_matches_fold_path() {
    const SESSION_ID: &str = "c2a34686-f99a-4632-90e2-e036b96124c2";
    const GOLDEN_NAME: &str = GOLDEN_CURSOR_JUNK_NAME;
    const PROJECT_PATH: &str = "/Users/alex/Documents/sandbox";

    let fixture_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");

    let events = CursorHistorySource
        .read(HistoryInput {
            session_id: SESSION_ID.to_string(),
            workspace_root: Some(fixture_dir),
        })
        .expect("read cursor junk fixture via HistorySource");

    let ctx = FoldContext::new(SESSION_ID, CanonicalAgentId::Cursor, PROJECT_PATH);
    let graph = fold_full(&events, &ctx);
    let current = extract_persisted_region(&graph);
    let golden_path = golden_fixture_dir().join(format!("{GOLDEN_NAME}.json"));

    if !golden_path.exists() || should_update_goldens() {
        write_persisted_golden(GOLDEN_NAME, &graph);
        return;
    }

    let expected = load_persisted_golden(GOLDEN_NAME);
    assert_eq!(
        persisted_json(&current),
        persisted_json(&expected),
        "persisted session graph mismatch for {GOLDEN_NAME}"
    );
}
