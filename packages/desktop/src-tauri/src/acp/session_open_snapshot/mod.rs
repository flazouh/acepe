//! `SessionOpenResult` — unified session-open contract.
//!
//! Describes the full canonical session state at a proven journal cutoff, along
//! with an attach-ready open token that guarantees gap-free delta delivery from
//! that cutoff once the client claims it (Unit 3).
//!
//! ## Ordering guarantee
//!
//! `assemble_session_open_result` arms the `event_hub` reservation for
//! `open_token` **before** assembling snapshot content.  Any delta published
//! to the hub for `canonical_session_id` after arming is captured in the
//! reservation buffer and remains available for ordered flush at connect time
//! (Unit 3).  A concurrent event that hits the journal within the tiny window
//! between `max_event_seq` read and reservation arming will appear in the
//! buffer and may also be reflected in the projection — deduplication by
//! `last_event_seq` at claim time (Unit 3) ensures it is not delivered twice.

use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::ProjectionRegistry;
use crate::acp::projections::{
    InteractionSnapshot, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_journal::{load_stored_projection, load_transcript_from_journal};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::transcript_projection::TranscriptSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::{
    SessionJournalEventRepository, SessionMetadataRepository, SessionProjectionSnapshotRepository,
    SessionTranscriptSnapshotRepository,
};
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

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
    Missing(SessionOpenMissing),
    Error(SessionOpenError),
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
pub struct SessionOpenError {
    pub requested_session_id: String,
    pub message: String,
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
    // --- Transcript content (canonical contract) ---
    pub transcript_snapshot: TranscriptSnapshot,
    pub session_title: String,
    // --- Canonical projection state ---
    pub operations: Vec<OperationSnapshot>,
    pub interactions: Vec<InteractionSnapshot>,
    pub turn_state: SessionTurnState,
    pub message_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_terminal_turn_id: Option<String>,
}

// ============================================================================
// Assembly helpers
// ============================================================================

/// Build a short display title from a session ID (first 8 chars).
pub(crate) fn default_session_title(session_id: &str) -> String {
    format!("Session {}", &session_id[..8.min(session_id.len())])
}

pub(crate) fn resolve_canonical_session_title(
    metadata: Option<&crate::db::repository::SessionMetadataRow>,
    session_id: &str,
) -> String {
    metadata
        .map(|row| row.display.trim())
        .filter(|display| !display.is_empty())
        .map(std::borrow::ToOwned::to_owned)
        .unwrap_or_else(|| default_session_title(session_id))
}

fn build_projection_from_thread_snapshot(
    replay_context: &SessionReplayContext,
    snapshot: &SessionThreadSnapshot,
) -> crate::acp::projections::SessionProjectionSnapshot {
    ProjectionRegistry::project_thread_snapshot(
        &replay_context.local_session_id,
        Some(replay_context.agent_id.clone()),
        snapshot,
    )
}

pub async fn session_open_result_from_thread_snapshot(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
    snapshot: &SessionThreadSnapshot,
) -> SessionOpenResult {
    let canonical_session_id = &replay_context.local_session_id;
    let is_alias = requested_session_id != canonical_session_id;
    let last_event_seq =
        match SessionJournalEventRepository::max_event_seq(db, canonical_session_id).await {
            Ok(seq) => seq.unwrap_or(0),
            Err(err) => {
                return SessionOpenResult::Error(SessionOpenError {
                    requested_session_id: requested_session_id.to_string(),
                    message: format!(
                    "Failed to determine journal cutoff for session {canonical_session_id}: {err}"
                ),
                });
            }
        };

    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(
        open_token,
        canonical_session_id.clone(),
        last_event_seq,
        epoch_ms,
    );

    let session_metadata =
        match SessionMetadataRepository::get_by_id(db, canonical_session_id).await {
            Ok(metadata) => metadata,
            Err(err) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError {
                    requested_session_id: requested_session_id.to_string(),
                    message: format!(
                        "Failed to load session metadata for session {canonical_session_id}: {err}"
                    ),
                });
            }
        };
    let Some(session_metadata) = session_metadata else {
        hub.supersede_reservation(open_token);
        return SessionOpenResult::Error(SessionOpenError {
            requested_session_id: requested_session_id.to_string(),
            message: format!("Session metadata missing for session {canonical_session_id}"),
        });
    };

    let projection = build_projection_from_thread_snapshot(replay_context, snapshot);
    let session_snap = projection.session.as_ref();
    let operations = projection.operations;
    let interactions = projection.interactions;
    let graph_revision = session_snap
        .map(|session| session.last_event_seq)
        .unwrap_or(last_event_seq);
    let turn_state = session_snap
        .map(|session| session.turn_state.clone())
        .unwrap_or(SessionTurnState::Idle);
    let message_count = session_snap
        .map(|session| session.message_count)
        .unwrap_or(0);
    let active_turn_failure = session_snap.and_then(|session| session.active_turn_failure.clone());
    let last_terminal_turn_id =
        session_snap.and_then(|session| session.last_terminal_turn_id.clone());
    let transcript_snapshot =
        TranscriptSnapshot::from_stored_entries(last_event_seq, &snapshot.entries);

    SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: requested_session_id.to_string(),
        canonical_session_id: canonical_session_id.clone(),
        is_alias,
        last_event_seq,
        graph_revision,
        open_token: open_token.to_string(),
        agent_id: replay_context.agent_id.clone(),
        project_path: replay_context.project_path.clone(),
        worktree_path: replay_context.worktree_path.clone(),
        source_path: replay_context.source_path.clone(),
        transcript_snapshot,
        session_title: resolve_canonical_session_title(
            Some(&session_metadata),
            canonical_session_id,
        ),
        operations,
        interactions,
        turn_state,
        message_count,
        active_turn_failure,
        last_terminal_turn_id,
    }))
}

/// Assemble a `SessionOpenResult` for an existing session from persisted state.
///
/// **Ordering guarantee**: the `event_hub` reservation for the returned
/// `open_token` is armed *before* projection snapshot assembly begins.  Any
/// delta published to the hub for `canonical_session_id` after arming is
/// captured in the reservation buffer.
///
/// Returns `Error` when any piece of persisted state cannot be proven
/// consistent with the same journal cutoff.
pub async fn assemble_session_open_result(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
) -> SessionOpenResult {
    let canonical_session_id = &replay_context.local_session_id;
    let is_alias = requested_session_id != canonical_session_id;

    // --- 1. Determine the proven journal cutoff ---
    let last_event_seq =
        match SessionJournalEventRepository::max_event_seq(db, canonical_session_id).await {
            Ok(seq) => seq.unwrap_or(0),
            Err(err) => {
                return SessionOpenResult::Error(SessionOpenError {
                    requested_session_id: requested_session_id.to_string(),
                    message: format!(
                    "Failed to determine journal cutoff for session {canonical_session_id}: {err}"
                ),
                });
            }
        };

    // --- 2. Arm the reservation BEFORE assembling snapshot content ---
    //
    // After this point, any event published to the hub for this session is
    // captured in the buffer, so nothing can slip through the gap between
    // snapshot assembly and connect-time claim.
    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(
        open_token,
        canonical_session_id.clone(),
        last_event_seq,
        epoch_ms,
    );

    // --- 3. Load canonical projection at the proven cutoff ---
    let persisted_projection =
        match SessionProjectionSnapshotRepository::get(db, canonical_session_id).await {
            Ok(proj) => proj,
            Err(err) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError {
                    requested_session_id: requested_session_id.to_string(),
                    message: format!(
                        "Failed to load projection for session {canonical_session_id}: {err}"
                    ),
                });
            }
        };
    let projection = if persisted_projection
        .as_ref()
        .and_then(|snapshot| snapshot.session.as_ref())
        .is_some_and(|session| session.last_event_seq >= last_event_seq)
    {
        persisted_projection
    } else {
        match load_stored_projection(db, replay_context).await {
            Ok(snapshot) => snapshot.or(persisted_projection),
            Err(err) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError {
                    requested_session_id: requested_session_id.to_string(),
                    message: format!(
                        "Failed to rebuild projection for session {canonical_session_id}: {err}"
                    ),
                });
            }
        }
    };
    let Some(projection) = projection else {
        hub.supersede_reservation(open_token);
        return SessionOpenResult::Error(SessionOpenError {
            requested_session_id: requested_session_id.to_string(),
            message: format!(
                "Canonical projection snapshot missing for session {canonical_session_id}"
            ),
        });
    };

    let session_snap = projection.session.as_ref();
    let operations = projection.operations;
    let interactions = projection.interactions;
    let graph_revision = session_snap
        .map(|s| s.last_event_seq)
        .unwrap_or(last_event_seq);
    let turn_state = session_snap
        .map(|s| s.turn_state.clone())
        .unwrap_or(SessionTurnState::Idle);
    let message_count = session_snap.map(|s| s.message_count).unwrap_or(0);
    let active_turn_failure = session_snap.and_then(|s| s.active_turn_failure.clone());
    let last_terminal_turn_id = session_snap.and_then(|s| s.last_terminal_turn_id.clone());

    // --- 4. Resolve thread content ---
    let persisted_transcript =
        match SessionTranscriptSnapshotRepository::get(db, canonical_session_id).await {
            Ok(snapshot) => snapshot,
            Err(err) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError {
                    requested_session_id: requested_session_id.to_string(),
                    message: format!(
                    "Failed to load transcript snapshot for session {canonical_session_id}: {err}"
                ),
                });
            }
        };
    let session_metadata =
        match SessionMetadataRepository::get_by_id(db, canonical_session_id).await {
            Ok(metadata) => metadata,
            Err(err) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError {
                    requested_session_id: requested_session_id.to_string(),
                    message: format!(
                        "Failed to load session metadata for session {canonical_session_id}: {err}"
                    ),
                });
            }
        };
    let transcript_snapshot = if persisted_transcript
        .as_ref()
        .is_some_and(|snapshot| snapshot.revision >= last_event_seq)
    {
        persisted_transcript
    } else {
        match load_transcript_from_journal(db, replay_context).await {
            Ok(snapshot) => snapshot.or(persisted_transcript),
            Err(err) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError {
                    requested_session_id: requested_session_id.to_string(),
                    message: format!(
                        "Failed to rebuild transcript snapshot for session {canonical_session_id}: {err}"
                    ),
                });
            }
        }
    };
    let transcript_snapshot = transcript_snapshot
        .unwrap_or_else(|| TranscriptSnapshot::from_stored_entries(last_event_seq, &[]));
    let Some(session_metadata) = session_metadata else {
        hub.supersede_reservation(open_token);
        return SessionOpenResult::Error(SessionOpenError {
            requested_session_id: requested_session_id.to_string(),
            message: format!(
                "Canonical session metadata missing for session {canonical_session_id}"
            ),
        });
    };
    let session_title =
        resolve_canonical_session_title(Some(&session_metadata), canonical_session_id);

    SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: requested_session_id.to_string(),
        canonical_session_id: canonical_session_id.clone(),
        is_alias,
        last_event_seq,
        graph_revision,
        open_token: open_token.to_string(),
        agent_id: replay_context.agent_id.clone(),
        project_path: replay_context.project_path.clone(),
        worktree_path: replay_context.worktree_path.clone(),
        source_path: replay_context.source_path.clone(),
        transcript_snapshot,
        session_title,
        operations,
        interactions,
        turn_state,
        message_count,
        active_turn_failure,
        last_terminal_turn_id,
    }))
}

/// Build a `found` result for a brand-new session that has no persisted state
/// yet.
///
/// Arms a reservation at `last_event_seq = 0` (or the proven initial cutoff
/// when a seed journal event was persisted before this call).
pub async fn session_open_result_for_new_session(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    session_id: &str,
    agent_id: CanonicalAgentId,
    project_path: String,
    worktree_path: Option<String>,
    source_path: Option<String>,
) -> SessionOpenResult {
    let last_event_seq = match SessionJournalEventRepository::max_event_seq(db, session_id).await {
        Ok(seq) => seq.unwrap_or(0),
        Err(err) => {
            return SessionOpenResult::Error(SessionOpenError {
                requested_session_id: session_id.to_string(),
                message: format!(
                    "Failed to determine journal cutoff for new session {session_id}: {err}"
                ),
            });
        }
    };

    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(open_token, session_id.to_string(), last_event_seq, epoch_ms);

    SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: session_id.to_string(),
        canonical_session_id: session_id.to_string(),
        is_alias: false,
        last_event_seq,
        graph_revision: last_event_seq,
        open_token: open_token.to_string(),
        agent_id,
        project_path,
        worktree_path,
        source_path,
        transcript_snapshot: TranscriptSnapshot::from_stored_entries(last_event_seq, &[]),
        session_title: default_session_title(session_id),
        operations: vec![],
        interactions: vec![],
        turn_state: SessionTurnState::Idle,
        message_count: 0,
        active_turn_failure: None,
        last_terminal_turn_id: None,
    }))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::event_hub::AcpEventHubState;
    use crate::acp::session_update::{
        SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::db::repository::{SessionJournalEventRepository, SessionMetadataRepository};
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use serde_json::json;
    use std::sync::Arc;

    async fn setup_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory db");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("migrations");
        db
    }

    fn make_hub() -> Arc<AcpEventHubState> {
        Arc::new(AcpEventHubState::new())
    }

    async fn seed_session_metadata(db: &DbConn, session_id: &str, agent_id: &str) {
        SessionMetadataRepository::ensure_exists(db, session_id, "/test/project", agent_id, None)
            .await
            .expect("seed metadata");
    }

    async fn append_tool_call_event(db: &DbConn, session_id: &str) {
        let update = SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: format!("tc-{}", uuid::Uuid::new_v4()),
                name: "Read".to_string(),
                arguments: ToolArguments::Read {
                    file_path: Some("/test/file.rs".to_string()),
                    source_context: None,
                },
                raw_input: None,
                status: ToolCallStatus::Completed,
                result: None,
                kind: Some(ToolKind::Read),
                title: Some("Read file".to_string()),
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some(session_id.to_string()),
        };
        SessionJournalEventRepository::append_session_update(db, session_id, &update)
            .await
            .expect("append journal event");
    }

    // -----------------------------------------------------------------------
    // Happy path: new session returns found with empty state and seq=0
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn new_session_returns_found_with_empty_state_and_seq_zero() {
        let db = setup_db().await;
        let hub = make_hub();
        let session_id = "new-session-abc123";

        let result = session_open_result_for_new_session(
            &db,
            &hub,
            session_id,
            CanonicalAgentId::Copilot,
            "/test/project".to_string(),
            None,
            None,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        assert_eq!(found.canonical_session_id, session_id);
        assert_eq!(found.requested_session_id, session_id);
        assert!(!found.is_alias);
        assert_eq!(found.last_event_seq, 0);
        assert_eq!(found.transcript_snapshot.revision, 0);
        assert!(found.transcript_snapshot.entries.is_empty());
        assert!(found.operations.is_empty());
        assert!(found.interactions.is_empty());
        assert_eq!(found.turn_state, SessionTurnState::Idle);
        assert_eq!(found.message_count, 0);
        // open_token must be a valid UUID
        assert!(Uuid::parse_str(&found.open_token).is_ok());
    }

    // -----------------------------------------------------------------------
    // Edge case: new session with pre-existing journal event returns proven seq
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn new_session_with_seed_journal_event_returns_proven_seq() {
        let db = setup_db().await;
        let hub = make_hub();
        let session_id = "new-with-seed-abc";
        seed_session_metadata(&db, session_id, "copilot").await;
        // Simulate a seed journal event already persisted before open completes
        append_tool_call_event(&db, session_id).await;

        let result = session_open_result_for_new_session(
            &db,
            &hub,
            session_id,
            CanonicalAgentId::Copilot,
            "/test/project".to_string(),
            None,
            None,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        assert_eq!(found.last_event_seq, 1, "seed event should yield seq=1");
    }

    // -----------------------------------------------------------------------
    // Happy path: open token guarantees reservation is armed after assembly
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn found_result_open_token_has_active_reservation_in_hub() {
        let db = setup_db().await;
        let hub = make_hub();
        let session_id = "reservation-test-session";

        let result = session_open_result_for_new_session(
            &db,
            &hub,
            session_id,
            CanonicalAgentId::Copilot,
            "/test/project".to_string(),
            None,
            None,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        let token = Uuid::parse_str(&found.open_token).expect("valid uuid");
        assert!(
            hub.has_reservation(token),
            "reservation must be active after open"
        );
    }

    // -----------------------------------------------------------------------
    // Edge case: abandoned open token expires reservation buffer after TTL
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn expired_open_token_is_removed_after_gc() {
        let db = setup_db().await;
        let hub = make_hub();
        let session_id = "ttl-test-session";

        let result = session_open_result_for_new_session(
            &db,
            &hub,
            session_id,
            CanonicalAgentId::Copilot,
            "/test/project".to_string(),
            None,
            None,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        let token = Uuid::parse_str(&found.open_token).expect("valid uuid");
        // Manually expire the reservation by forcing GC with a zero TTL
        hub.gc_reservations_older_than(std::time::Duration::ZERO);
        assert!(
            !hub.has_reservation(token),
            "expired reservation should be removed by gc"
        );
    }

    // -----------------------------------------------------------------------
    // Integration: post-assembly delta captured in reservation buffer
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn post_assembly_event_captured_in_reservation_buffer() {
        let db = setup_db().await;
        let hub = make_hub();
        let session_id = "buffer-test-session";

        let result = session_open_result_for_new_session(
            &db,
            &hub,
            session_id,
            CanonicalAgentId::Copilot,
            "/test/project".to_string(),
            None,
            None,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

        // Publish a delta to the hub AFTER the open result is returned
        hub.publish(
            "session_update",
            Some(session_id.to_string()),
            json!({"type": "turn_complete"}),
            "high",
            false,
        );

        // The delta must be in the reservation buffer
        let buffered = hub.claim_reservation(token);
        assert!(
            buffered.is_some(),
            "claim must succeed for active reservation"
        );
        let events = buffered.unwrap();
        assert_eq!(events.len(), 1, "exactly one buffered delta expected");
        assert_eq!(events[0].event_name, "session_update");
    }

    // -----------------------------------------------------------------------
    // Integration: event for a different session is NOT buffered in reservation
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn event_for_different_session_not_captured_in_reservation() {
        let db = setup_db().await;
        let hub = make_hub();
        let session_id = "target-session";
        let other_session = "other-session";

        let result = session_open_result_for_new_session(
            &db,
            &hub,
            session_id,
            CanonicalAgentId::Copilot,
            "/test/project".to_string(),
            None,
            None,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

        // Publish an event for a different session
        hub.publish(
            "session_update",
            Some(other_session.to_string()),
            json!({"type": "turn_complete"}),
            "high",
            false,
        );

        let buffered = hub.claim_reservation(token);
        let events = buffered.unwrap_or_default();
        assert!(
            events.is_empty(),
            "events for other sessions must not be captured"
        );
    }

    // -----------------------------------------------------------------------
    // Edge case: claim supersedes reservation (single-use token)
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn open_token_is_single_use_second_claim_returns_none() {
        let db = setup_db().await;
        let hub = make_hub();
        let session_id = "single-use-session";

        let result = session_open_result_for_new_session(
            &db,
            &hub,
            session_id,
            CanonicalAgentId::Copilot,
            "/test/project".to_string(),
            None,
            None,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

        let first = hub.claim_reservation(token);
        assert!(first.is_some(), "first claim must succeed");

        let second = hub.claim_reservation(token);
        assert!(second.is_none(), "second claim of same token must fail");
    }

    #[tokio::test]
    async fn open_token_claim_rejects_wrong_session() {
        let db = setup_db().await;
        let hub = make_hub();
        let session_id = "claim-session";

        let result = session_open_result_for_new_session(
            &db,
            &hub,
            session_id,
            CanonicalAgentId::Copilot,
            "/test/project".to_string(),
            None,
            None,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

        let claimed = hub.claim_reservation_for_session(token, "other-session");
        assert!(
            claimed.is_none(),
            "claim must fail when the token is presented for a different session"
        );
        assert!(
            hub.has_reservation(token),
            "failed claim must leave the reservation intact"
        );
    }

    // -----------------------------------------------------------------------
    // Edge case: missing session returns Missing outcome, not partial data
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn missing_session_returns_missing_outcome() {
        // Note: assemble_session_open_result is called by the command layer only
        // when metadata IS found.  The Missing case is emitted by the command
        // layer itself.  We test here that the SessionOpenResult::Missing variant
        // serializes and round-trips correctly.
        let missing = SessionOpenResult::Missing(SessionOpenMissing {
            requested_session_id: "ghost-session-id".to_string(),
        });
        let json = serde_json::to_string(&missing).expect("serialize");
        let back: SessionOpenResult = serde_json::from_str(&json).expect("deserialize");
        let SessionOpenResult::Missing(m) = back else {
            panic!("expected Missing after round-trip");
        };
        assert_eq!(m.requested_session_id, "ghost-session-id");
    }

    // -----------------------------------------------------------------------
    // Error path: SessionOpenResult::Error round-trips correctly
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn error_outcome_round_trips_over_serde() {
        let err = SessionOpenResult::Error(SessionOpenError {
            requested_session_id: "bad-session".to_string(),
            message: "Something went wrong".to_string(),
        });
        let json = serde_json::to_string(&err).expect("serialize");
        let back: SessionOpenResult = serde_json::from_str(&json).expect("deserialize");
        let SessionOpenResult::Error(e) = back else {
            panic!("expected Error after round-trip");
        };
        assert_eq!(e.requested_session_id, "bad-session");
        assert_eq!(e.message, "Something went wrong");
    }
}
