//! Deletion gate for `session_converter` removal (clean session ingress Phase 2).
//!
//! These tests document readiness — they do not delete anything yet.

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
use crate::acp::session::tests::golden::{
    load_persisted_golden, GOLDEN_CURSOR_JUNK_NAME,
};
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

fn run_cursor_history_source_fold_oracle() -> Result<(), String> {
    const SESSION_ID: &str = "c2a34686-f99a-4632-90e2-e036b96124c2";

    let fixture_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cursor_sessions");

    let events = CursorHistorySource
        .read(HistoryInput {
            session_id: SESSION_ID.to_string(),
            workspace_root: Some(fixture_dir),
        })
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
        "src/acp/reconciler/tests/fixtures/historical-tool-call-session.jsonl",
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
        let entry = entry.unwrap_or_else(|error| panic!("read dir entry in {}: {error}", dir.display()));
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn all_phase0_golden_oracles_are_green() {
    let oracles = [ORACLE_CURSOR_HISTORY, ORACLE_HISTORICAL_TOOL_CALL];

    let mut ignored = Vec::new();
    let mut failing = Vec::new();

    for oracle in oracles {
        if oracle_is_ignored_elsewhere(oracle) {
            ignored.push(oracle);
        }

        let result = match oracle {
            ORACLE_CURSOR_HISTORY => run_cursor_history_source_fold_oracle(),
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
