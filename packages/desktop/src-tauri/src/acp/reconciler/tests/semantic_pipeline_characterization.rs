//! Pins **current** shared reconciler behavior before the provider-owned semantic pipeline lands.
//!
//! Related coverage:
//! - Parser-level SQL regression: `crate::acp::parsers::tests::sql_regression`
//! - Provider dispatch: `crate::acp::reconciler::providers::tests`
//! - Base reconciler cases: `reconciler_tests`

use crate::acp::parsers::AgentType;
use crate::acp::reconciler::providers;
use crate::acp::reconciler::{classify_with_provider_name_kind, RawClassificationInput};
use crate::acp::session_update::{ToolArguments, ToolKind};

/// Copilot-style read payload with `view_range` + line-prefixed excerpt: must become typed
/// [`ToolArguments::Read`] + [`crate::acp::session_update::ToolSourceContext`], not a single blob (R13).
#[test]
fn copilot_read_fixture_preserves_source_context_fields() {
    const FIXTURE: &str =
        include_str!("../../parsers/tests/fixtures/copilot_read_source_context.json");
    let payload: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture JSON");
    let raw_input = payload.get("rawInput").expect("rawInput");
    let args = crate::acp::parsers::arguments::parse_tool_kind_arguments(ToolKind::Read, raw_input);
    match args {
        ToolArguments::Read {
            file_path,
            source_context,
        } => {
            assert_eq!(file_path.as_deref(), Some("/project/src/lib.rs"));
            let ctx = source_context.expect("source context");
            assert_eq!(ctx.path.as_deref(), Some("/project/src/lib.rs"));
            assert_eq!(ctx.view_range.as_ref().and_then(|r| r.start_line), Some(5));
            assert_eq!(ctx.view_range.as_ref().and_then(|r| r.end_line), Some(20));
            assert!(ctx.excerpt.as_ref().is_some_and(|e| e.contains("main()")));
        }
        other => panic!("expected Read arguments, got {other:?}"),
    }
}

/// Mirrors `parsers/tests/fixtures/copilot_sql_regression.json` — weak Copilot identity (`kind: other`)
/// while `query` carries SQL; reconciler should emit canonical todo semantics, not SQL transport.
#[test]
fn copilot_sql_fixture_shape_matches_parser_regression() {
    const FIXTURE: &str = include_str!("../../parsers/tests/fixtures/copilot_sql_regression.json");
    let payload: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture JSON");

    let raw = RawClassificationInput {
        id: "toolu_fixture",
        name: Some("unknown"),
        title: payload.get("title").and_then(|v| v.as_str()),
        kind_hint: payload.get("kind").and_then(|v| v.as_str()),
        arguments: payload.get("rawInput").expect("rawInput"),
    };

    let out = providers::classify(AgentType::Copilot, &raw);
    assert_eq!(out.kind, ToolKind::Todo);
    assert!(matches!(
        out.arguments,
        ToolArguments::Think { raw: Some(_), .. }
    ));
}

/// When every signal fails, the live path must surface [`ToolKind::Unclassified`], not [`ToolKind::Other`].
#[test]
fn unmatched_payloads_are_unclassified_not_other() {
    let out = classify_with_provider_name_kind(
        AgentType::ClaudeCode,
        None,
        &RawClassificationInput {
            id: "tool-unmatched",
            name: Some("unknown"),
            title: None,
            kind_hint: Some("other"),
            arguments: &serde_json::json!({ "noise": true }),
        },
    );
    assert_eq!(out.kind, ToolKind::Unclassified);
    assert!(matches!(out.arguments, ToolArguments::Unclassified { .. }));
}

/// Provider name wins when present — `classify_with_provider_name_kind` short-circuits all fallbacks.
#[test]
fn provider_name_kind_short_circuit_skips_argument_shape() {
    let out = classify_with_provider_name_kind(
        AgentType::ClaudeCode,
        Some(ToolKind::Read),
        &RawClassificationInput {
            id: "id",
            name: Some("Read"),
            title: None,
            kind_hint: Some("other"),
            arguments: &serde_json::json!({
                "query": "UPDATE t SET x = 1"
            }),
        },
    );
    assert_eq!(out.kind, ToolKind::Read);
}

/// Minimal NDJSON used for replay/import characterization (each line must parse as JSON).
#[test]
fn historical_tool_call_session_fixture_lines_are_valid_json() {
    const FIXTURE: &str = include_str!("fixtures/historical-tool-call-session.jsonl");
    for line in FIXTURE.lines().map(str::trim).filter(|l| !l.is_empty()) {
        serde_json::from_str::<serde_json::Value>(line).unwrap_or_else(|e| {
            panic!("invalid JSON line in historical-tool-call-session.jsonl: {e}\n{line}");
        });
    }
}
