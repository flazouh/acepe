//! Plan 009 U1/U2: baseline characterization across all five tool-identity entry families.
//!
//! Pins current behavior before consolidating tool identity authority — including
//! promotion duplication between `mod.rs` and `session_tool.rs`, and streaming parity.
//! Tests import through the authority exports on `crate::acp::session::ingress::tool_identity` (plan 009 U2).
//!
//! Entry families (see `docs/plans/2026-06-11-009-refactor-tool-identity-authority-plan.md`):
//! 1. `classify_raw_tool_call`
//! 2. `classify_serialized_tool_call`
//! 3. `semantic_transition` (streaming)
//! 4. `infer_kind_from_payload(_for_agent)`
//! 5. `display_name_for_tool` / `providers::detect_tool_kind` (streaming fallback)

use crate::acp::parsers::{get_parser, AgentType, CopilotParser};
use crate::acp::session::ingress::tool_identity::providers;
use crate::acp::session::ingress::tool_identity::session_tool::classify_serialized_tool_call;
use crate::acp::session::ingress::tool_identity::{
    classify_raw_tool_call, classify_with_provider_name_kind, display_name_for_tool,
    infer_kind_from_payload, infer_kind_from_payload_for_agent, semantic_transition,
    RawClassificationInput, SignalName, ToolClassificationHints,
};
use crate::acp::session_update::{ToolArguments, ToolKind};

// --- Family 1: classify_raw_tool_call ---

#[test]
fn raw_unknown_tool_yields_unclassified_with_signals_never_other() {
    let parser = CopilotParser;
    let classified = classify_raw_tool_call(
        &parser,
        "tool-opaque",
        &serde_json::json!({ "noise": true }),
        ToolClassificationHints {
            name: Some("unknown"),
            title: Some("Mystery tool"),
            kind: Some(ToolKind::Other),
            kind_hint: Some("other"),
            locations: None,
        },
    );

    assert_eq!(classified.kind, ToolKind::Unclassified);
    assert_ne!(classified.kind, ToolKind::Other);
    match classified.arguments {
        ToolArguments::Unclassified { signals_tried, .. } => {
            assert!(!signals_tried.is_empty());
        }
        other => panic!("expected Unclassified arguments, got {other:?}"),
    }
}

#[test]
fn raw_web_search_promotion_matches_engine_for_cursor_ws_id() {
    let args = serde_json::json!({ "url": "https://example.com" });
    let raw_input = RawClassificationInput {
        id: "ws_promotion_pin",
        name: Some("unknown"),
        title: None,
        kind_hint: Some("fetch"),
        arguments: &args,
    };

    let engine = classify_with_provider_name_kind(AgentType::Cursor, None, &raw_input);
    let parser = get_parser(AgentType::Cursor);
    let session = classify_raw_tool_call(
        parser,
        "ws_promotion_pin",
        &args,
        ToolClassificationHints {
            name: Some("unknown"),
            title: None,
            kind: None,
            kind_hint: Some("fetch"),
            locations: None,
        },
    );

    assert_eq!(engine.kind, ToolKind::WebSearch);
    assert_eq!(
        session.kind, engine.kind,
        "session_tool web-search promotion must match engine"
    );
    assert_eq!(session.name, "WebSearch");
}

#[test]
fn raw_browser_promotion_matches_engine_for_webview_title() {
    let args = serde_json::json!({});
    let raw_input = RawClassificationInput {
        id: "tool-browser-pin",
        name: Some("unknown"),
        title: Some("webview_screenshot"),
        kind_hint: Some("other"),
        arguments: &args,
    };

    let engine = classify_with_provider_name_kind(AgentType::ClaudeCode, None, &raw_input);
    let parser = get_parser(AgentType::ClaudeCode);
    let session = classify_raw_tool_call(
        parser,
        "tool-browser-pin",
        &args,
        ToolClassificationHints {
            name: Some("unknown"),
            title: Some("webview_screenshot"),
            kind: None,
            kind_hint: Some("other"),
            locations: None,
        },
    );

    assert_eq!(engine.kind, ToolKind::Browser);
    assert_eq!(
        session.kind, engine.kind,
        "session_tool browser promotion must match engine"
    );
}

#[test]
fn raw_sql_todo_matches_semantic_transition_kind_and_name() {
    let args = serde_json::json!({
        "description": "Mark all done",
        "query": "UPDATE todos SET status = 'done'"
    });
    let raw_input = RawClassificationInput {
        id: "tool-sql-parity",
        name: Some("unknown"),
        title: Some("Mark all done"),
        kind_hint: Some("other"),
        arguments: &args,
    };

    let transition = semantic_transition(AgentType::Copilot, &raw_input);
    let parser = CopilotParser;
    let classified = classify_raw_tool_call(
        &parser,
        "tool-sql-parity",
        &args,
        ToolClassificationHints {
            name: Some("unknown"),
            title: Some("Mark all done"),
            kind: None,
            kind_hint: Some("other"),
            locations: None,
        },
    );

    assert_eq!(classified.kind, transition.record.kind);
    assert_eq!(classified.kind, ToolKind::Todo);
    // Oddity pinned: session_tool canonicalizes Todo as "Todo"; streaming normalization uses "TodoWrite".
    assert_eq!(classified.name, "Todo");
}

// --- Family 2: classify_serialized_tool_call ---

#[test]
fn serialized_unknown_tool_yields_unclassified_with_signals_never_other() {
    let classified = classify_serialized_tool_call(
        AgentType::Copilot,
        "tool-serialized-opaque",
        &serde_json::json!({ "opaque": { "nested": true } }),
        ToolClassificationHints {
            name: Some("unknown"),
            title: Some("Mystery serialized tool"),
            kind: Some(ToolKind::Other),
            kind_hint: Some("other"),
            locations: None,
        },
    );

    assert_eq!(classified.kind, ToolKind::Unclassified);
    assert_ne!(classified.kind, ToolKind::Other);
    match classified.arguments {
        ToolArguments::Unclassified { signals_tried, .. } => {
            assert!(!signals_tried.is_empty());
        }
        other => panic!("expected Unclassified arguments, got {other:?}"),
    }
}

#[test]
fn serialized_web_search_promotion_matches_engine_for_cursor_ws_id() {
    let args = serde_json::json!({ "url": "https://example.com" });
    let raw_input = RawClassificationInput {
        id: "ws_serialized_pin",
        name: Some("unknown"),
        title: None,
        kind_hint: Some("fetch"),
        arguments: &args,
    };

    let engine = classify_with_provider_name_kind(AgentType::Cursor, None, &raw_input);
    let serialized = classify_serialized_tool_call(
        AgentType::Cursor,
        "ws_serialized_pin",
        &args,
        ToolClassificationHints {
            name: Some("unknown"),
            title: None,
            kind: None,
            kind_hint: Some("fetch"),
            locations: None,
        },
    );

    assert_eq!(engine.kind, ToolKind::WebSearch);
    assert_eq!(
        serialized.kind, engine.kind,
        "serialized web-search promotion must match engine"
    );
}

// --- Family 3: semantic_transition (streaming) ---

#[test]
fn semantic_transition_parity_with_classify_raw_for_copilot_todo() {
    let args = serde_json::json!({
        "description": "Mark all done",
        "query": "UPDATE todos SET status = 'done'"
    });
    let raw_input = RawClassificationInput {
        id: "stream-todo-parity",
        name: Some("unknown"),
        title: Some("unknown"),
        kind_hint: Some("other"),
        arguments: &args,
    };

    let direct = providers::classify(AgentType::Copilot, &raw_input);
    let transition = semantic_transition(AgentType::Copilot, &raw_input);
    let classified = classify_raw_tool_call(
        &CopilotParser,
        "stream-todo-parity",
        &args,
        ToolClassificationHints {
            name: Some("unknown"),
            title: Some("unknown"),
            kind: None,
            kind_hint: Some("other"),
            locations: None,
        },
    );

    assert_eq!(direct.kind, transition.record.kind);
    assert_eq!(classified.kind, transition.record.kind);
    assert_eq!(transition.record.kind, ToolKind::Todo);
}

#[test]
fn semantic_transition_never_surfaces_other_for_empty_signals() {
    let raw_input = RawClassificationInput {
        id: "stream-unclassified",
        name: Some("unknown"),
        title: None,
        kind_hint: Some("other"),
        arguments: &serde_json::json!({}),
    };

    let transition = semantic_transition(AgentType::ClaudeCode, &raw_input);

    assert_eq!(transition.record.kind, ToolKind::Unclassified);
    assert_ne!(transition.record.kind, ToolKind::Other);
    assert_eq!(
        transition.signals_tried,
        vec![
            SignalName::ProviderName,
            SignalName::ArgumentShape,
            SignalName::AcpKindHint,
            SignalName::TitleHeuristic
        ]
    );
}

// --- Family 4: infer_kind_from_payload(_for_agent) ---

#[test]
fn infer_kind_from_payload_for_each_provider_table() {
    assert_eq!(
        infer_kind_from_payload_for_agent(AgentType::ClaudeCode, "id", None, Some("read")),
        Some(ToolKind::Read)
    );
    assert_eq!(
        infer_kind_from_payload_for_agent(AgentType::Copilot, "id", None, Some("read")),
        Some(ToolKind::Read)
    );
    assert_eq!(
        infer_kind_from_payload_for_agent(AgentType::Cursor, "ws_cursor", None, Some("search")),
        Some(ToolKind::WebSearch)
    );
    assert_eq!(
        infer_kind_from_payload_for_agent(
            AgentType::Codex,
            "id",
            Some("exec_command"),
            Some("other")
        ),
        Some(ToolKind::Execute)
    );
    assert_eq!(
        infer_kind_from_payload_for_agent(AgentType::OpenCode, "id", None, Some("glob")),
        Some(ToolKind::Glob)
    );
}

#[test]
fn infer_kind_from_payload_title_heuristic_pins_browser() {
    assert_eq!(
        infer_kind_from_payload("id", Some("webview_screenshot"), Some("other")),
        Some(ToolKind::Browser)
    );
}

// --- Family 5: display_name_for_tool ---

#[test]
fn display_name_for_tool_uses_canonical_kind_name() {
    assert_eq!(display_name_for_tool(ToolKind::Read, "read_file"), "Read");
    assert_eq!(
        display_name_for_tool(ToolKind::WebSearch, "ws_tool"),
        "Web Search"
    );
}

#[test]
fn display_name_for_tool_falls_back_to_provider_name_for_other() {
    assert_eq!(
        display_name_for_tool(ToolKind::Other, "custom_mcp_tool"),
        "custom_mcp_tool"
    );
}

// --- Family 5b: providers::detect_tool_kind (streaming fallback) ---

#[test]
fn detect_tool_kind_one_name_per_provider_table() {
    assert_eq!(
        providers::detect_tool_kind(AgentType::ClaudeCode, "read_file"),
        ToolKind::Read
    );
    assert_eq!(
        providers::detect_tool_kind(AgentType::Copilot, "update_todos"),
        ToolKind::Todo
    );
    assert_eq!(
        providers::detect_tool_kind(AgentType::Cursor, "codebase_search"),
        ToolKind::Search
    );
    assert_eq!(
        providers::detect_tool_kind(AgentType::Codex, "shell_command"),
        ToolKind::Execute
    );
    assert_eq!(
        providers::detect_tool_kind(AgentType::OpenCode, "readFile"),
        ToolKind::Read
    );
}

#[test]
fn detect_tool_kind_streaming_fallback_name_never_other() {
    // Mirrors `streaming_accumulator::normalize_from_cached` when tool_name is missing
    // and falls back to the literal `"other"` before `semantic_transition`.
    let kind = providers::detect_tool_kind(AgentType::Copilot, "other");
    assert_ne!(kind, ToolKind::Other);
}

#[test]
fn detect_tool_kind_matches_classify_name_only_path() {
    let agent = AgentType::Cursor;
    let name = "codebase_search";
    let detect = providers::detect_tool_kind(agent, name);
    let classify = providers::classify(
        agent,
        &RawClassificationInput {
            id: "",
            name: Some(name),
            title: None,
            kind_hint: None,
            arguments: &serde_json::Value::Null,
        },
    );
    assert_eq!(detect, classify.kind);
}
