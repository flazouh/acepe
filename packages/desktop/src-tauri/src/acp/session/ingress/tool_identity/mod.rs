//! Tool identity authority — one canonical interface for tool kind, name, and argument interpretation.
//!
//! External callers must route classification through the **public entry set** below. Provider name
//! tables, signal heuristics, and post-classification promotions are private implementation details
//! behind this surface.
//!
//! ## Public entry points
//!
//! | Entry | Use when |
//! |---|---|
//! | [`classify_raw_tool_call`] | Live/raw tool payloads (converters, router, permission handler) |
//! | [`classify_serialized_tool_call`] | Materialized or history tool rows |
//! | [`semantic_transition`] | Streaming deltas (accumulator, replay helpers) |
//! | [`infer_kind_from_payload`] / [`infer_kind_from_payload_for_agent`] | ACP `kind` hint inference (parsers) |
//! | [`display_name_for_tool`] / [`canonical_name_for_kind`] | User-facing display names from kind + provider name |
//! | [`classify_kind_from_provider_name`] | Name-table kind lookup (router, enrichment) |
//!
//! ## Classification precedence
//!
//! Load-bearing order (see `docs/solutions/best-practices/deterministic-tool-call-reconciler-2026-04-18.md`):
//!
//! 1. Provider-owned name normalization (`providers::classify` / `detect_tool_kind`)
//! 2. Argument-shape classification (`classify_argument_shape`)
//! 3. ACP kind hint (`classify_kind_hint`)
//! 4. Title heuristic (`classify_title_heuristic`)
//! 5. Explicit [`ToolKind::Unclassified`] with non-empty `signals_tried` diagnostics
//!
//! Post-classification promotions (todo-SQL, web-search, browser) run once after the signal chain
//! inside [`classify_with_provider_name_kind`].
//!
//! ## Never-silent-`Other` contract
//!
//! When every signal in the precedence chain fails, the authority emits [`ToolKind::Unclassified`]
//! with [`ToolArguments::Unclassified`] carrying `signals_tried` — never a silent [`ToolKind::Other`].
//! Callers must not repair or reclassify downstream; fix the canonical producer instead.

use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::AgentType;
use crate::acp::session_update::{ToolArguments, ToolKind};

mod classify_signals;
pub(crate) mod diagnostics;
mod kind_payload;
pub(crate) mod projector;
pub(crate) mod providers;
pub(crate) mod raw_events;
pub(crate) mod semantic;
pub(crate) mod session_tool;
pub(crate) mod state;

use classify_signals::{
    build_unclassified, classify_argument_shape, classify_kind_hint, classify_title_heuristic,
};
use kind_payload::{is_browser_tool_name, is_web_search_title, looks_like_web_search_arguments};

// --- Tool identity authority: public entry set (plan 009 U2) ---

pub use kind_payload::{
    canonical_name_for_kind, display_name_for_tool, infer_kind_from_payload,
    infer_kind_from_payload_for_agent,
};
pub use providers::{
    ClaudeCodeAdapter, CodexAdapter, CopilotAdapter, CursorAdapter, OpenCodeAdapter,
};
pub(crate) use session_tool::{
    classify_raw_tool_call, classify_serialized_tool_call, resolve_raw_tool_identity,
    ClassifiedToolData, ToolClassificationHints,
};

/// Resolve tool kind from a provider tool name via the authority name-table path.
///
/// Used when callers already have a concrete tool name (or ACP kind string treated as a name
/// hint) and need a [`ToolKind`] without re-entering the full raw-call funnel.
pub fn classify_kind_from_provider_name(agent: AgentType, name: &str) -> ToolKind {
    providers::detect_tool_kind(agent, name)
}

/// Whether id/title/argument signals indicate web-search context (Codex parser promotion path).
pub fn web_search_context_signals(
    id: &str,
    title: Option<&str>,
    arguments: Option<&serde_json::Value>,
) -> bool {
    id.starts_with("web_search_")
        || title.map(is_web_search_title).unwrap_or(false)
        || arguments
            .map(looks_like_web_search_arguments)
            .unwrap_or(false)
}

/// Signals tried during fallback classification (recorded for diagnostics / `Unclassified` payloads).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignalName {
    /// Provider name table was consulted but produced no match.
    ProviderName,
    ArgumentShape,
    AcpKindHint,
    TitleHeuristic,
}

impl SignalName {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SignalName::ProviderName => "provider_name",
            SignalName::ArgumentShape => "argument_shape",
            SignalName::AcpKindHint => "acp_kind_hint",
            SignalName::TitleHeuristic => "title_heuristic",
        }
    }
}

#[derive(Debug)]
pub(crate) struct RawClassificationInput<'a> {
    pub id: &'a str,
    pub name: Option<&'a str>,
    pub title: Option<&'a str>,
    pub kind_hint: Option<&'a str>,
    pub arguments: &'a serde_json::Value,
}

#[derive(Debug)]
pub(crate) struct ClassificationOutput {
    pub kind: ToolKind,
    pub arguments: ToolArguments,
    #[allow(dead_code)]
    pub signals_tried: Vec<SignalName>,
}

/// Streaming-transition entry: provider dispatch + shared signals + projection.
///
/// Authority entry for streaming deltas. Prefer this over [`providers::classify`] at call sites
/// (streaming accumulator, replay helpers) so provider dispatch and projection stay centralized.
pub(crate) fn semantic_transition(
    agent: AgentType,
    raw: &RawClassificationInput<'_>,
) -> semantic::SemanticTransition {
    let output = providers::classify(agent, raw);
    let normalization_name = normalization_name(raw.name, raw.title, output.kind);
    projector::transition_from_classification(output, &normalization_name, raw.arguments, agent)
}

fn normalization_name(name: Option<&str>, title: Option<&str>, kind: ToolKind) -> String {
    let usable_name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| !value.eq_ignore_ascii_case("unknown"));
    if let Some(name) = usable_name {
        return name.to_string();
    }

    if let Some(title) = title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| !value.eq_ignore_ascii_case("unknown"))
    {
        return title.to_string();
    }

    match kind {
        ToolKind::Todo => "TodoWrite".to_string(),
        ToolKind::Question => "AskUserQuestion".to_string(),
        ToolKind::WebSearch => "WebSearch".to_string(),
        ToolKind::Other | ToolKind::Unclassified => "unknown".to_string(),
        other => other.as_str().to_string(),
    }
}

/// Core classification engine: takes an optional pre-resolved provider kind, then falls through
/// shared heuristics. Called by `providers::classify` — not for direct use outside `providers/`.
pub(crate) fn classify_with_provider_name_kind(
    agent: AgentType,
    provider_name_kind: Option<ToolKind>,
    raw: &RawClassificationInput<'_>,
) -> ClassificationOutput {
    let mut signals_tried = Vec::new();

    let base_kind = if let Some(kind) = provider_name_kind {
        Some(kind)
    } else {
        signals_tried.push(SignalName::ProviderName);

        if let Some(kind) = classify_argument_shape(raw.arguments) {
            Some(kind)
        } else {
            signals_tried.push(SignalName::ArgumentShape);

            if let Some(kind) = classify_kind_hint(raw.kind_hint) {
                Some(kind)
            } else {
                signals_tried.push(SignalName::AcpKindHint);

                if let Some(kind) = classify_title_heuristic(raw.title) {
                    Some(kind)
                } else {
                    signals_tried.push(SignalName::TitleHeuristic);
                    None
                }
            }
        }
    };

    let final_kind =
        apply_post_classification_promotions(agent, base_kind.unwrap_or(ToolKind::Other), raw);

    let arguments = if final_kind == ToolKind::Other {
        build_unclassified(raw, &signals_tried)
    } else {
        build_arguments(final_kind, raw, &signals_tried)
    };

    ClassificationOutput {
        kind: if final_kind == ToolKind::Other {
            ToolKind::Unclassified
        } else {
            final_kind
        },
        arguments,
        signals_tried,
    }
}

fn build_arguments(
    kind: ToolKind,
    raw: &RawClassificationInput<'_>,
    signals_tried: &[SignalName],
) -> ToolArguments {
    if kind == ToolKind::Unclassified {
        return build_unclassified(raw, signals_tried);
    }

    parse_tool_kind_arguments(kind, raw.arguments)
}

fn apply_post_classification_promotions(
    agent: AgentType,
    base_kind: ToolKind,
    raw: &RawClassificationInput<'_>,
) -> ToolKind {
    let todo_promoted = apply_todo_sql_promotion(base_kind, raw);
    let web_search_promoted = apply_web_search_promotion(agent, todo_promoted, raw);
    apply_browser_promotion(web_search_promoted, raw)
}

fn apply_todo_sql_promotion(base_kind: ToolKind, raw: &RawClassificationInput<'_>) -> ToolKind {
    if base_kind != ToolKind::Sql {
        return base_kind;
    }

    let sql = raw
        .arguments
        .as_object()
        .and_then(|object| {
            object
                .get("query")
                .or_else(|| object.get("sql"))
                .or_else(|| object.get("statement"))
        })
        .and_then(|value| value.as_str())
        .map(|value| value.to_ascii_lowercase());

    if sql
        .as_deref()
        .is_some_and(|query| query.contains("todos") || query.contains("todo_deps"))
    {
        ToolKind::Todo
    } else {
        base_kind
    }
}

fn apply_web_search_promotion(
    agent: AgentType,
    base_kind: ToolKind,
    raw: &RawClassificationInput<'_>,
) -> ToolKind {
    let argument_implied_web_search = matches!(base_kind, ToolKind::Fetch | ToolKind::Other)
        && looks_like_web_search_arguments(raw.arguments);

    if matches!(
        base_kind,
        ToolKind::Fetch | ToolKind::Search | ToolKind::Other
    ) && (providers::is_web_search_tool_call_id(agent, raw.id)
        || raw.title.map(is_web_search_title).unwrap_or(false)
        || argument_implied_web_search)
    {
        ToolKind::WebSearch
    } else {
        base_kind
    }
}

fn apply_browser_promotion(base_kind: ToolKind, raw: &RawClassificationInput<'_>) -> ToolKind {
    let name_is_browser = raw.name.map(is_browser_tool_name).unwrap_or(false);
    let title_is_browser = raw.title.map(is_browser_tool_name).unwrap_or(false);
    let id_is_browser = is_browser_tool_name(raw.id);

    if (name_is_browser || title_is_browser || id_is_browser)
        && matches!(
            base_kind,
            ToolKind::Other
                | ToolKind::Read
                | ToolKind::Execute
                | ToolKind::Search
                | ToolKind::Fetch
        )
    {
        ToolKind::Browser
    } else {
        base_kind
    }
}

#[cfg(test)]
mod tests;
