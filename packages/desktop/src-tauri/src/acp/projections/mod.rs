//! Session and interaction projection snapshots for the hub (operations, permissions, questions).
//!
//! Tool-call **argument** semantics and payload shaping for the desktop wire contract live in
//! [`crate::acp::tool_identity`]. This module tracks operational state derived from
//! already-projected [`ToolCallData`] / updates — it does not re-classify tools.

use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::{
    InteractionReplyHandler, PermissionData, QuestionData, SessionUpdate, ToolArguments,
    ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind, ToolReference, ToolSourceContext,
};
use crate::acp::transcript_projection::{live_tool_entry_id_for_tool_call, TranscriptEntryRole};
use crate::acp::types::CanonicalAgentId;
use crate::acp::types::ContentBlock;
use crate::computer_use::permissions::build_computer_permission_interaction_id;
use crate::session_jsonl::types::StoredEntry;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use specta::Type;
use std::sync::Arc;

const CLAUDE_RESUMED_MISSING_TOOL_RESULT_MESSAGE: &str =
    "Result unavailable: the agent resumed after this tool call but did not provide stdout/stderr to Acepe.";
const READ_SOURCE_EXCERPT_MAX_BYTES: u64 = 512 * 1024;

pub mod types;
pub use types::*;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SessionProjectionSnapshot {
    pub session: Option<SessionSnapshot>,
    pub operations: Vec<OperationSnapshot>,
    pub interactions: Vec<InteractionSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<crate::acp::lifecycle::LifecycleCheckpoint>,
}

pub mod terminal_turn_guard;
pub use terminal_turn_guard::{RouteDecision, TerminalTurnGuard};

#[derive(Debug, Clone, Default)]
pub struct ProjectionRegistry {
    snapshots: Arc<DashMap<String, SessionSnapshot>>,
    operations_by_id: Arc<DashMap<String, OperationSnapshot>>,
    operation_id_by_tool_key: Arc<DashMap<String, String>>,
    session_operation_ids: Arc<DashMap<String, Vec<String>>>,
    last_cancelled_operation_ids: Arc<DashMap<String, Vec<String>>>,
    interactions_by_id: Arc<DashMap<String, InteractionSnapshot>>,
    interaction_id_by_request_key: Arc<DashMap<String, String>>,
    session_interaction_ids: Arc<DashMap<String, Vec<String>>>,
}

pub mod bridge;
pub mod helpers;
pub mod interactions;
pub mod operations;
pub mod projection_apply_router;
pub mod session_lifecycle;
pub(crate) use helpers::*;
pub use projection_apply_router::{
    route_projection_apply, ProjectionApplyArm, ProjectionApplyRoute,
};

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
