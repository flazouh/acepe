#![allow(unused_imports)]

use super::*;
use crate::acp::client_trait::CommunicationMode;
use crate::acp::error::{CreationFailure, CreationFailureKind};
use crate::acp::event_hub::{AcpEventHubState, OpenTokenClaim};
use crate::acp::lifecycle::{ReadyDispatchPermit, SessionSupervisor};
use crate::acp::projections::{ProjectionRegistry, SessionProjectionSnapshot};
use crate::acp::session_descriptor::{
    resolve_live_pending_session_resume, ResolvedForkSession, ResolvedResumeSession,
    SessionCompatibilityInput, SessionReplayContext,
};
use crate::acp::session_materialization::materialize_provider_owned_thread_snapshot;
use crate::acp::session_open_snapshot::{
    derive_title_from_transcript_snapshot, resolve_canonical_session_title,
    session_open_result_for_new_session, NewSessionOpenResultInput, SessionOpenFound,
    SessionOpenResult,
};
use crate::acp::session_policy::SessionPolicyRegistry;
use crate::acp::session_registry::{redact_session_id, SessionRegistry};
use crate::acp::session_state_engine::bridge::build_snapshot_envelope;
use crate::acp::session_state_engine::envelope::{
    session_state_envelope_byte_budget_status, SessionStateEnvelope,
};
use crate::acp::session_state_engine::graph::select_active_streaming_tail;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::runtime_registry::{
    LiveSessionStateEnvelopeRequest, SessionGraphRuntimeRegistry, SessionGraphRuntimeSnapshot,
};
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities,
};
use crate::acp::transcript_projection::{TranscriptProjectionRegistry, TranscriptSnapshot};
use crate::acp::types::CanonicalAgentId;
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use crate::db::repository::{
    SessionJournalEventRepository, SessionMetadataRepository, SessionMetadataRow,
};
use sea_orm::DbConn;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use std::sync::Arc;

mod basic;
mod fork_close;
mod lifecycle;
mod metadata;
mod new_session;
mod open_result;
mod open_token;
mod resume;
mod state;
mod state_lookup;

#[cfg(test)]
mod tests;

pub(crate) use basic::acp_set_session_autonomous_for_handle;
pub use basic::{acp_get_event_bridge_info, acp_initialize, acp_set_session_autonomous};
pub(crate) use fork_close::fork_preflight_with_app_handle;
pub use fork_close::{acp_close_session, acp_fork_session};
#[cfg(test)]
use lifecycle::load_transcript_snapshot_for_resume;
use lifecycle::{
    emit_detached_lifecycle, load_live_session_graph_revision,
    load_transcript_snapshot_for_resume_with_app, replay_buffered_session_state_events,
};
pub(crate) use lifecycle::{emit_lifecycle_event, publish_session_state_envelope};
use metadata::{
    creation_failure, ensure_session_anchor_snapshots, mark_creation_attempt_failed,
    resolve_fork_session_target, resolve_resume_session_target,
};
pub(crate) use metadata::{
    persist_session_metadata_for_cwd, resolve_requested_agent_id,
    session_metadata_context_from_cwd, validate_provider_session_id_for_creation,
};
pub use new_session::acp_new_session;
use open_result::{build_new_session_open_result, capabilities_from_new_session_response};
use open_token::claim_open_token_reservation;
pub use resume::acp_resume_session;
pub(crate) use resume::resume_session_with_app_handle_and_worker;
pub use state::acp_get_session_state;
#[cfg(test)]
use state::load_transcript_snapshot_for_state_lookup;
use state::{
    load_session_projection_lookup, load_transcript_snapshot_for_state_lookup_with_app,
    projection_has_graph_state,
};
use state_lookup::{
    projection_snapshot_with_runtime, resolve_state_lookup_authority, runtime_snapshot_for_refresh,
    warn_unresolved_tool_rows_in_state_lookup,
};
