//! Canonical ingress fact vocabulary — provider-agnostic events fed to `engine::fold`.

use crate::acp::session_update::{
    AvailableCommandsData, CurrentModeData, PermissionData, PlanData, QuestionData,
    SessionCompactionEvent, ToolCallData, ToolCallUpdateData, UsageTelemetryData,
};
use crate::acp::types::CanonicalAgentId;
use crate::cc_sdk::AssistantMessageError;

/// A single provider-agnostic fact emitted by ingress before folding.
#[derive(Debug, Clone)]
pub struct ProviderEvent {
    pub source: CanonicalAgentId,
    pub provider_seq: u64,
    pub provider_row_id: String,
    pub timestamp_ms: Option<i64>,
    pub kind: ProviderEventKind,
}

/// Closed fact vocabulary — no provider branches, no `Other`.
#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum ProviderEventKind {
    UserText {
        text: String,
        attempt_id: Option<String>,
    },
    UserPastedContent {
        text: String,
    },
    AssistantText {
        text: String,
    },
    AssistantThought {
        text: String,
        redacted: Option<String>,
    },
    AssistantError {
        text: String,
        error: AssistantMessageError,
    },
    ToolCall(ToolCallData),
    ToolCallUpdate(ToolCallUpdateData),
    Permission(PermissionData),
    Question(QuestionData),
    Plan(PlanData),
    Usage(UsageTelemetryData),
    ModeUpdate(CurrentModeData),
    CapabilitiesUpdate(AvailableCommandsData),
    TurnBegin {
        request_id: Option<String>,
    },
    TurnEnd {
        outcome: TurnOutcome,
    },
    Compaction(SessionCompactionEvent),
}

/// Explicit turn boundary outcome for history and live ingress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOutcome {
    Completed,
    Failed,
    Cancelled,
}

impl ProviderEventKind {
    pub(crate) fn discriminant_label(&self) -> &'static str {
        match self {
            ProviderEventKind::UserText { .. } => "user_text",
            ProviderEventKind::UserPastedContent { .. } => "user_pasted",
            ProviderEventKind::AssistantText { .. } => "assistant_text",
            ProviderEventKind::AssistantThought { .. } => "assistant_thought",
            ProviderEventKind::AssistantError { .. } => "assistant_error",
            ProviderEventKind::ToolCall(_) => "tool_call",
            ProviderEventKind::ToolCallUpdate(_) => "tool_call_update",
            ProviderEventKind::Permission(_) => "permission",
            ProviderEventKind::Question(_) => "question",
            ProviderEventKind::Plan(_) => "plan",
            ProviderEventKind::Usage(_) => "usage",
            ProviderEventKind::ModeUpdate(_) => "mode_update",
            ProviderEventKind::CapabilitiesUpdate(_) => "capabilities_update",
            ProviderEventKind::TurnBegin { .. } => "turn_begin",
            ProviderEventKind::TurnEnd { .. } => "turn_end",
            ProviderEventKind::Compaction(_) => "compaction",
        }
    }
}

impl ProviderEvent {
    pub(crate) fn kind_discriminant(&self) -> &'static str {
        self.kind.discriminant_label()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_event_user_text_fields() {
        let event = ProviderEvent {
            source: CanonicalAgentId::ClaudeCode,
            provider_seq: 1,
            provider_row_id: "row-1".to_string(),
            timestamp_ms: Some(1_700_000_000_000),
            kind: ProviderEventKind::UserText {
                text: "hello".to_string(),
                attempt_id: None,
            },
        };

        assert_eq!(event.source, CanonicalAgentId::ClaudeCode);
        assert_eq!(event.provider_seq, 1);
        assert_eq!(event.provider_row_id, "row-1");
        assert_eq!(event.timestamp_ms, Some(1_700_000_000_000));
        match event.kind {
            ProviderEventKind::UserText { text, .. } => assert_eq!(text, "hello"),
            _ => panic!("expected UserText"),
        }
    }
}
