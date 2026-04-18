use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::AgentType;
use crate::acp::session_update::{ToolArguments, ToolKind};

pub(crate) mod classify_signals;
pub(crate) mod diagnostics;
pub(crate) mod kind_payload;
pub(crate) mod projector;
pub(crate) mod providers;
pub(crate) mod raw_events;
pub(crate) mod semantic;
pub(crate) mod session_tool;
pub(crate) mod state;

use classify_signals::{
    build_unclassified, classify_argument_shape, classify_kind_hint, classify_title_heuristic,
};
use kind_payload::{
    is_browser_tool_name, is_web_search_id, is_web_search_title, looks_like_web_search_arguments,
};

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

/// Classify with the provider reducer + shared signals, then project through [`semantic::SemanticTransition`].
///
/// Prefer this over [`providers::classify`] at call sites (streaming, replay helpers) so
/// provider dispatch and projection stay centralized.
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
        apply_post_classification_promotions(base_kind.unwrap_or(ToolKind::Other), raw);

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
    base_kind: ToolKind,
    raw: &RawClassificationInput<'_>,
) -> ToolKind {
    let web_search_promoted = apply_web_search_promotion(base_kind, raw);
    apply_browser_promotion(web_search_promoted, raw)
}

fn apply_web_search_promotion(base_kind: ToolKind, raw: &RawClassificationInput<'_>) -> ToolKind {
    let argument_implied_web_search = matches!(base_kind, ToolKind::Fetch | ToolKind::Other)
        && looks_like_web_search_arguments(raw.arguments);

    if matches!(
        base_kind,
        ToolKind::Fetch | ToolKind::Search | ToolKind::Other
    ) && (is_web_search_id(raw.id)
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
