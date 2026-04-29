use serde::Serialize;
use specta::Type;

use crate::acp::client_session::{SessionModelState, SessionModes};
use crate::acp::lifecycle::FailureReason;

use super::{
    AvailableCommand, AvailableCommandsData, ConfigOptionData, ConfigOptionUpdateData,
    ContentChunk, CurrentModeData, PermissionData, PlanData, QuestionData, ToolCallData,
    ToolCallUpdateData, TurnErrorData, UsageTelemetryData,
};

/// Session update types from ACP protocol.
///
/// These are notifications sent by the agent during a prompt response.
/// They represent streaming updates to the session state.
///
/// Uses internally tagged representation with `type` field for clean TypeScript discrimination.
/// Example: `{ "type": "toolCall", "tool_call": {...}, "session_id": "..." }`
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)]
pub enum SessionUpdate {
    UserMessageChunk {
        chunk: ContentChunk,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    AgentMessageChunk {
        chunk: ContentChunk,
        #[serde(skip_serializing_if = "Option::is_none")]
        part_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    AgentThoughtChunk {
        chunk: ContentChunk,
        #[serde(skip_serializing_if = "Option::is_none")]
        part_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    ToolCall {
        tool_call: ToolCallData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    ToolCallUpdate {
        update: ToolCallUpdateData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    Plan {
        plan: PlanData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    AvailableCommandsUpdate {
        update: AvailableCommandsData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    CurrentModeUpdate {
        update: CurrentModeData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    ConfigOptionUpdate {
        update: ConfigOptionUpdateData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    PermissionRequest {
        permission: PermissionData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    QuestionRequest {
        question: QuestionData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },

    /// Indicates that the current turn/prompt has completed.
    /// This is emitted when the JSON-RPC response for a prompt request is received.
    TurnComplete {
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
    },

    /// Indicates that the current turn/prompt failed with an error.
    /// This is emitted when the JSON-RPC response contains an error.
    TurnError {
        /// The error message to display to the user.
        error: TurnErrorData,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
    },

    /// Usage/cost and token telemetry from the agent (adapter-agnostic).
    /// Emitted by adapters (e.g. OpenCode step-finish) for spend and context UI.
    UsageTelemetryUpdate { data: UsageTelemetryData },

    /// Emitted by the async resume task when session connection completes successfully.
    /// Carries the session capabilities so the frontend can populate hot state.
    ConnectionComplete {
        session_id: String,
        attempt_id: u64,
        models: SessionModelState,
        modes: SessionModes,
        #[serde(default)]
        available_commands: Vec<AvailableCommand>,
        #[serde(default)]
        config_options: Vec<ConfigOptionData>,
        autonomous_enabled: bool,
    },

    /// Emitted by the async resume task when session connection fails.
    ///
    /// `failure_reason` carries the canonical classification (e.g.
    /// `SessionGoneUpstream` for upstream-permanent failures, `ResumeFailed`
    /// for transient/transport faults). `error` carries the raw provider
    /// text verbatim for log/debug surfaces; user-facing English copy is
    /// composed downstream in TS from `(agentId, failure_reason)`.
    ConnectionFailed {
        session_id: String,
        attempt_id: u64,
        error: String,
        failure_reason: FailureReason,
    },
}

impl SessionUpdate {
    /// Get the session_id from the update, if present.
    pub fn session_id(&self) -> Option<&str> {
        match self {
            SessionUpdate::UserMessageChunk { session_id, .. } => session_id.as_deref(),
            SessionUpdate::AgentMessageChunk { session_id, .. } => session_id.as_deref(),
            SessionUpdate::AgentThoughtChunk { session_id, .. } => session_id.as_deref(),
            SessionUpdate::ToolCall { session_id, .. } => session_id.as_deref(),
            SessionUpdate::ToolCallUpdate { session_id, .. } => session_id.as_deref(),
            SessionUpdate::Plan { session_id, .. } => session_id.as_deref(),
            SessionUpdate::AvailableCommandsUpdate { session_id, .. } => session_id.as_deref(),
            SessionUpdate::CurrentModeUpdate { session_id, .. } => session_id.as_deref(),
            SessionUpdate::ConfigOptionUpdate { session_id, .. } => session_id.as_deref(),
            SessionUpdate::PermissionRequest { session_id, .. } => session_id.as_deref(),
            SessionUpdate::QuestionRequest { session_id, .. } => session_id.as_deref(),
            SessionUpdate::TurnComplete { session_id, .. } => session_id.as_deref(),
            SessionUpdate::TurnError { session_id, .. } => session_id.as_deref(),
            SessionUpdate::UsageTelemetryUpdate { data, .. } => Some(data.session_id.as_str()),
            SessionUpdate::ConnectionComplete { session_id, .. } => Some(session_id.as_str()),
            SessionUpdate::ConnectionFailed { session_id, .. } => Some(session_id.as_str()),
        }
    }
}
