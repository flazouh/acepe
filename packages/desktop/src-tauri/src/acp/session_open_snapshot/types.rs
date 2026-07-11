use crate::acp::projections::{
    InteractionSnapshot, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_state_engine::graph::ActiveStreamingTail;
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::SessionStateEnvelope;
use crate::acp::transcript_projection::TranscriptSnapshot;
use crate::acp::transcript_viewport::TranscriptViewportRow;
use crate::acp::types::CanonicalAgentId;
use serde::{Deserialize, Serialize};

// ============================================================================
// Public contract types
// ============================================================================

/// The unified outcome of a session-open request.
///
/// Returned by every session entry point (new, resume, history open).  The
/// frontend MUST NOT fetch projection state separately after receiving a
/// `Found` result; everything needed before live connect begins is included.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum SessionOpenResult {
    /// Session was found; all pre-connect state is fully populated.
    ///
    /// `Box`ed to keep the enum size bounded — `SessionOpenFound` carries
    /// the full projection snapshot, which is significantly larger than the
    /// `Missing` and `Error` payloads.
    Found(Box<SessionOpenFound>),
    Preparing(SessionOpenPreparing),
    Missing(SessionOpenMissing),
    Error(SessionOpenError),
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenPreparing {
    pub requested_session_id: String,
    pub repair_ticket: String,
}

/// Payload for the `missing` outcome — no persisted content was found for the
/// requested session identifier.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenMissing {
    pub requested_session_id: String,
}

/// Payload for the `error` outcome — persisted state was found but could not
/// be loaded or proven consistent.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SessionOpenErrorReason {
    ParseFailure,
    ProviderUnavailable,
    ProviderHistoryMissing,
    ProviderUnparseable,
    ProviderValidationFailed,
    StaleLineageRecovery,
    Internal,
}

/// Payload for the `error` outcome — persisted state was found but could not
/// be loaded or proven consistent.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenError {
    pub requested_session_id: String,
    pub message: String,
    pub reason: SessionOpenErrorReason,
    pub retryable: bool,
}

/// Diagnostic-only timing for the restored-session open path.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenResultTiming {
    pub source: String,
    pub open_path: SessionOpenPath,
    pub ledger_probe_status: String,
    pub context_ms: u128,
    pub provider_load_ms: u128,
    pub ledger_tail_read_ms: u128,
    pub ledger_journal_cutoff_ms: u128,
    pub ledger_page_read_ms: u128,
    pub ledger_header_decode_ms: u128,
    pub ledger_rows_decode_ms: u128,
    pub ledger_result_build_ms: u128,
    pub runtime_lookup_ms: u128,
    pub assemble_ms: u128,
    pub restore_authority_ms: u128,
    pub compact_ms: u128,
    pub local_journal_fallback_ms: u128,
    pub total_ms: u128,
    pub transcript_entry_count: usize,
    pub operation_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionOpenPath {
    HotLedger,
    LegacyRebuild,
    CompatSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenTranscriptRowPage {
    pub projection_version: String,
    pub start_row_index: i64,
    pub total_row_count: i64,
    pub row_payload_bytes: u64,
    pub transcript_revision: i64,
    pub graph_revision: i64,
    pub last_event_seq: i64,
    pub rows: Vec<TranscriptViewportRow>,
}

impl SessionOpenError {
    #[must_use]
    pub fn parse_failure(
        requested_session_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            requested_session_id: requested_session_id.into(),
            message: message.into(),
            reason: SessionOpenErrorReason::ParseFailure,
            retryable: false,
        }
    }

    #[must_use]
    pub fn provider_unavailable(
        requested_session_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            requested_session_id: requested_session_id.into(),
            message: message.into(),
            reason: SessionOpenErrorReason::ProviderUnavailable,
            retryable: true,
        }
    }

    #[must_use]
    pub fn provider_history_missing(
        requested_session_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            requested_session_id: requested_session_id.into(),
            message: message.into(),
            reason: SessionOpenErrorReason::ProviderHistoryMissing,
            retryable: false,
        }
    }

    #[must_use]
    pub fn provider_unparseable(
        requested_session_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            requested_session_id: requested_session_id.into(),
            message: message.into(),
            reason: SessionOpenErrorReason::ProviderUnparseable,
            retryable: false,
        }
    }

    #[must_use]
    pub fn provider_validation_failed(
        requested_session_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            requested_session_id: requested_session_id.into(),
            message: message.into(),
            reason: SessionOpenErrorReason::ProviderValidationFailed,
            retryable: false,
        }
    }

    #[must_use]
    pub fn stale_lineage_recovery(
        requested_session_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            requested_session_id: requested_session_id.into(),
            message: message.into(),
            reason: SessionOpenErrorReason::StaleLineageRecovery,
            retryable: true,
        }
    }

    #[must_use]
    pub fn internal(requested_session_id: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            requested_session_id: requested_session_id.into(),
            message: message.into(),
            reason: SessionOpenErrorReason::Internal,
            retryable: true,
        }
    }
}

/// Full payload for a `found` outcome.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenFound {
    /// The ID supplied by the caller (may be a provider-side alias).
    pub requested_session_id: String,
    /// The Acepe-local canonical session identifier.
    pub canonical_session_id: String,
    /// `true` when `requested_session_id` differs from `canonical_session_id`
    /// (i.e. the caller supplied a provider-side alias that was resolved to a
    /// different canonical ID).
    pub is_alias: bool,
    /// Proven journal cutoff.  `0` only when no journal events exist yet.
    pub last_event_seq: i64,
    /// Canonical graph frontier at the proven cutoff.
    ///
    /// During the compatibility window this may still be seeded from persisted
    /// state that mirrors `last_event_seq`, but open/materialization paths must
    /// carry it explicitly instead of re-deriving graph lineage from delivery.
    pub graph_revision: i64,
    /// Single-use attach token (UUID string).  All hub events for this session
    /// published after this token is armed are buffered in the `event_hub`
    /// reservation until the token is claimed (Unit 3) or expires after 30 s
    /// of inactivity.
    pub open_token: String,
    // --- Session identity ---
    pub agent_id: CanonicalAgentId,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence_id: Option<i32>,
    // --- Transcript content (canonical contract) ---
    pub transcript_snapshot: TranscriptSnapshot,
    pub session_title: String,
    // --- Canonical projection state ---
    pub operations: Vec<OperationSnapshot>,
    pub interactions: Vec<InteractionSnapshot>,
    pub turn_state: SessionTurnState,
    pub message_count: u64,
    pub activity: SessionGraphActivity,
    pub active_streaming_tail: Option<ActiveStreamingTail>,
    // --- Canonical lifecycle/actionability authority ---
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
    pub open_path: SessionOpenPath,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_transcript_row_page: Option<SessionOpenTranscriptRowPage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_viewport_envelope: Option<SessionStateEnvelope>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_result_timing: Option<SessionOpenResultTiming>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_terminal_turn_id: Option<String>,
}

/// Build a `found` result for a brand-new session that has no persisted state
/// yet.
///
/// Arms a reservation at `last_event_seq = 0` (or the proven initial cutoff
/// when a seed journal event was persisted before this call).
pub struct NewSessionOpenResultInput {
    pub session_id: String,
    pub agent_id: CanonicalAgentId,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub source_path: Option<String>,
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
}
