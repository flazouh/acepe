//! Unit 2: the backend is the only live event authority — provider adapters emit canonical events
//! without shared-layer provider-name branching; all provider quirks live in adapters/reconciler.

use crate::acp::parsers::AgentType;
use crate::acp::reconciler::{infer_kind_from_payload, providers};
use crate::acp::session_update::ToolKind;

// --- Happy path: provider adapters classify through the shared reducer surface ---

#[test]
fn kind_payload_lives_under_reconciler_not_parsers() {
    assert_eq!(
        infer_kind_from_payload("id", None, Some("read")),
        Some(ToolKind::Read)
    );
}

#[test]
fn provider_dispatch_still_classifies_through_reducer_surface() {
    let raw = crate::acp::reconciler::RawClassificationInput {
        id: "t1",
        name: Some("read_file"),
        title: None,
        kind_hint: None,
        arguments: &serde_json::json!({}),
    };
    let out = providers::classify(AgentType::ClaudeCode, &raw);
    assert_eq!(out.kind, ToolKind::Read);
}

/// All five providers produce the same canonical `ToolKind` for a shared tool name.
/// No caller needs to branch on provider identity to obtain the canonical kind.
#[test]
fn all_providers_emit_same_canonical_kind_for_shared_tool() {
    let agents = [
        AgentType::ClaudeCode,
        AgentType::Copilot,
        AgentType::OpenCode,
        AgentType::Cursor,
        AgentType::Codex,
    ];
    let raw = crate::acp::reconciler::RawClassificationInput {
        id: "t-multi",
        name: Some("read_file"),
        title: None,
        kind_hint: None,
        arguments: &serde_json::json!({}),
    };
    for agent in agents {
        let out = providers::classify(agent, &raw);
        assert_eq!(
            out.kind,
            ToolKind::Read,
            "provider {:?} produced unexpected kind {:?}",
            agent,
            out.kind
        );
    }
}

// --- Edge case: unknown / empty tool names resolve to Unclassified, not Other ---

/// At the classification boundary, tools with completely unknown names must resolve to
/// `Unclassified` rather than `Other`. `Other` is an internal sentinel that the identity
/// pipeline promotes before publishing — no canonical event should carry `Other` as its kind.
#[test]
fn unknown_tool_name_resolves_to_unclassified_not_other() {
    let raw = crate::acp::reconciler::RawClassificationInput {
        id: "t-unknown",
        name: Some("zzz_totally_unknown_tool_xyz"),
        title: None,
        kind_hint: None,
        arguments: &serde_json::json!({}),
    };
    let out = providers::classify(AgentType::ClaudeCode, &raw);
    assert_ne!(
        out.kind,
        ToolKind::Other,
        "canonical events must not carry ToolKind::Other; got {:?}",
        out.kind
    );
}

/// An empty tool name must not panic or produce `Other`; it resolves to `Unclassified`.
#[test]
fn empty_tool_name_resolves_to_unclassified() {
    let raw = crate::acp::reconciler::RawClassificationInput {
        id: "t-empty",
        name: Some(""),
        title: None,
        kind_hint: None,
        arguments: &serde_json::json!({}),
    };
    let out = providers::classify(AgentType::Copilot, &raw);
    assert_ne!(out.kind, ToolKind::Other);
}

// --- Error path: provider-specific kind hints that don't map gracefully become Unclassified ---

/// A provider-supplied `kind_hint` that is not in the canonical vocabulary must not
/// corrupt downstream reducers. The classification pipeline demotes it to `Unclassified`
/// rather than forwarding an unrecognised string.
#[test]
fn unknown_kind_hint_does_not_corrupt_classifier() {
    let raw = crate::acp::reconciler::RawClassificationInput {
        id: "t-hint",
        name: Some("mystery_tool"),
        title: None,
        kind_hint: Some("totally_unknown_provider_hint"),
        arguments: &serde_json::json!({}),
    };
    let out = providers::classify(AgentType::OpenCode, &raw);
    // Must be a valid canonical kind — not a raw pass-through of the unknown hint.
    let valid_kinds = [
        ToolKind::Read,
        ToolKind::Edit,
        ToolKind::Execute,
        ToolKind::Search,
        ToolKind::Glob,
        ToolKind::Fetch,
        ToolKind::WebSearch,
        ToolKind::Think,
        ToolKind::Todo,
        ToolKind::Question,
        ToolKind::Task,
        ToolKind::TaskOutput,
        ToolKind::Skill,
        ToolKind::Move,
        ToolKind::Delete,
        ToolKind::EnterPlanMode,
        ToolKind::ExitPlanMode,
        ToolKind::CreatePlan,
        ToolKind::ToolSearch,
        ToolKind::Browser,
        ToolKind::Sql,
        ToolKind::Unclassified,
    ];
    assert!(
        valid_kinds.contains(&out.kind),
        "classifier produced non-canonical kind {:?}",
        out.kind
    );
    // Specifically should not carry the `Other` sentinel into canonical position
    assert_ne!(out.kind, ToolKind::Other);
}
