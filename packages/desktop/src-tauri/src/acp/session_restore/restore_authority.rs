use std::sync::Arc;

use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_open_snapshot::{
    session_projection_snapshot_from_open_found, SessionOpenResult,
};
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use tauri::{AppHandle, Manager};

pub fn restore_session_open_authority<R: tauri::Runtime>(
    app: &AppHandle<R>,
    result: &SessionOpenResult,
) {
    let SessionOpenResult::Found(found) = result else {
        return;
    };
    // Viewport authority is keyed only by the canonical session id; the frontend
    // re-keys to the canonical id at open time, so no alias duplication is needed.
    let canonical_session_id = &found.canonical_session_id;

    if let Some(transcript_registry) = app.try_state::<Arc<TranscriptProjectionRegistry>>() {
        transcript_registry.inner().restore_session_snapshot(
            canonical_session_id.clone(),
            found.transcript_snapshot.clone(),
        );
    }

    if let Some(runtime_registry) = app.try_state::<Arc<SessionGraphRuntimeRegistry>>() {
        runtime_registry.inner().restore_open_session_state(
            canonical_session_id.clone(),
            found.graph_revision,
            found.lifecycle.clone(),
            found.capabilities.clone(),
        );
    }

    if let Some(projection_registry) = app.try_state::<Arc<ProjectionRegistry>>() {
        projection_registry
            .inner()
            .restore_session_projection(session_projection_snapshot_from_open_found(found));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::acp::lifecycle::LifecycleStatus;
    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_open_snapshot::{SessionOpenFound, SessionOpenPath, SessionOpenResult};
    use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
    };
    use crate::acp::transcript_projection::TranscriptSnapshot;
    use crate::acp::types::CanonicalAgentId;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    use super::restore_session_open_authority;

    #[test]
    fn restore_session_open_authority_seeds_runtime_lifecycle_checkpoint() {
        let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::new());
        let projection_registry = Arc::new(crate::acp::projections::ProjectionRegistry::new());
        let transcript_registry =
            Arc::new(crate::acp::transcript_projection::TranscriptProjectionRegistry::new());
        let app = mock_builder()
            .manage(Arc::clone(&runtime_registry))
            .manage(projection_registry)
            .manage(transcript_registry)
            .build(mock_context(noop_assets()))
            .expect("mock app");

        restore_session_open_authority(app.handle(), &found_result("session-1", 42));

        let snapshot = runtime_registry.snapshot_for_session("session-1");
        assert_eq!(snapshot.graph_revision, 42);
        assert_eq!(snapshot.lifecycle.status, LifecycleStatus::Reconnecting);
        assert_eq!(snapshot.lifecycle.detached_reason, None);
    }

    #[test]
    fn restore_session_open_authority_does_not_downgrade_ready_runtime_lifecycle() {
        let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::new());
        runtime_registry.restore_session_state(
            "session-1".to_string(),
            99,
            SessionGraphLifecycle::ready(),
            SessionGraphCapabilities::empty(),
        );
        let projection_registry = Arc::new(crate::acp::projections::ProjectionRegistry::new());
        let transcript_registry =
            Arc::new(crate::acp::transcript_projection::TranscriptProjectionRegistry::new());
        let app = mock_builder()
            .manage(Arc::clone(&runtime_registry))
            .manage(projection_registry)
            .manage(transcript_registry)
            .build(mock_context(noop_assets()))
            .expect("mock app");

        restore_session_open_authority(app.handle(), &found_result("session-1", 42));

        let snapshot = runtime_registry.snapshot_for_session("session-1");
        assert_eq!(snapshot.graph_revision, 99);
        assert_eq!(snapshot.lifecycle.status, LifecycleStatus::Ready);
    }

    fn found_result(session_id: &str, graph_revision: i64) -> SessionOpenResult {
        SessionOpenResult::Found(Box::new(SessionOpenFound {
            requested_session_id: session_id.to_string(),
            canonical_session_id: session_id.to_string(),
            is_alias: false,
            last_event_seq: 7,
            graph_revision,
            open_token: "open-token".to_string(),
            agent_id: CanonicalAgentId::Codex,
            project_path: "/repo".to_string(),
            worktree_path: None,
            source_path: None,
            sequence_id: Some(119),
            transcript_snapshot: TranscriptSnapshot {
                revision: 3,
                entries: Vec::new(),
            },
            session_title: "Session".to_string(),
            operations: Vec::new(),
            interactions: Vec::new(),
            turn_state: SessionTurnState::Completed,
            message_count: 1,
            activity: SessionGraphActivity::idle(),
            active_streaming_tail: None,
            lifecycle: SessionGraphLifecycle::reconnecting(),
            capabilities: SessionGraphCapabilities::empty(),
            open_path: SessionOpenPath::HotLedger,
            initial_transcript_row_page: None,
            initial_viewport_envelope: None,
            open_result_timing: None,
            active_turn_failure: None,
            last_terminal_turn_id: None,
        }))
    }
}
