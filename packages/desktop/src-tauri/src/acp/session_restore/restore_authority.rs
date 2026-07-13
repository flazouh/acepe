use std::sync::Arc;

use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_open_snapshot::{
    session_projection_snapshot_from_open_found, SessionOpenResult,
};
use crate::acp::session_state_engine::{
    build_graph_from_open_found, runtime_registry::SessionGraphRuntimeRegistry,
    selectors::select_session_graph_activity,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use tauri::{AppHandle, Manager};

pub async fn restore_session_open_authority<R: tauri::Runtime>(
    app: &AppHandle<R>,
    result: &SessionOpenResult,
) {
    let SessionOpenResult::Found(found) = result else {
        return;
    };
    // Viewport authority is keyed only by the canonical session id; the frontend
    // re-keys to the canonical id at open time, so no alias duplication is needed.
    let canonical_session_id = &found.canonical_session_id;

    let mut winning_graph = None;
    if let Some(runtime_registry) = app.try_state::<Arc<SessionGraphRuntimeRegistry>>() {
        let replaced_control_plane = runtime_registry
            .inner()
            .restore_open_session_state(
                canonical_session_id.clone(),
                found.last_event_seq,
                found.lifecycle.clone(),
                found.capabilities.clone(),
            )
            .await;

        // A hot-ledger open can carry a bounded transcript page. It still
        // defines the canonical reconnect/frontier graph that live events
        // must continue from; it is not a request to load provider history.
        let mut graph = build_graph_from_open_found(found);
        if let Some(runtime) = runtime_registry
            .inner()
            .current_snapshot_for_session(canonical_session_id)
        {
            graph.lifecycle = runtime.lifecycle;
            graph.capabilities = runtime.capabilities;
            graph.activity = select_session_graph_activity(
                &graph.lifecycle,
                &graph.turn_state,
                &graph.operations,
                &graph.interactions,
                graph.active_turn_failure.as_ref(),
            );
        }
        winning_graph = Some(runtime_registry.inner().restore_open_graph(
            canonical_session_id.clone(),
            graph,
            replaced_control_plane,
        ));
    }

    if let Some(transcript_registry) = app.try_state::<Arc<TranscriptProjectionRegistry>>() {
        let transcript_snapshot = winning_graph
            .as_ref()
            .map(|graph| graph.transcript_snapshot.clone())
            .unwrap_or_else(|| found.transcript_snapshot.clone());
        transcript_registry
            .inner()
            .restore_session_snapshot(canonical_session_id.clone(), transcript_snapshot);
    }

    if let Some(projection_registry) = app.try_state::<Arc<ProjectionRegistry>>() {
        if let Some(graph) = winning_graph.as_ref() {
            projection_registry.inner().mirror_session_graph(graph);
        } else {
            projection_registry
                .inner()
                .restore_session_projection(session_projection_snapshot_from_open_found(found));
        }
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

    #[tokio::test]
    async fn restore_session_open_authority_seeds_runtime_lifecycle_checkpoint() {
        let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::new());
        let projection_registry = Arc::new(crate::acp::projections::ProjectionRegistry::new());
        let transcript_registry =
            Arc::new(crate::acp::transcript_projection::TranscriptProjectionRegistry::new());
        let app = mock_builder()
            .manage(Arc::clone(&runtime_registry))
            .manage(Arc::clone(&projection_registry))
            .manage(Arc::clone(&transcript_registry))
            .build(mock_context(noop_assets()))
            .expect("mock app");

        restore_session_open_authority(&app.handle(), &found_result("session-1", 42)).await;

        let snapshot = runtime_registry.snapshot_for_session("session-1");
        assert_eq!(snapshot.graph_revision, 42);
        assert_eq!(snapshot.lifecycle.status, LifecycleStatus::Reconnecting);
        assert_eq!(snapshot.lifecycle.detached_reason, None);
    }

    #[tokio::test]
    async fn restore_session_open_authority_seeds_held_reconnect_graph_from_hot_ledger() {
        let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::new());
        let projection_registry = Arc::new(crate::acp::projections::ProjectionRegistry::new());
        let transcript_registry =
            Arc::new(crate::acp::transcript_projection::TranscriptProjectionRegistry::new());
        let app = mock_builder()
            .manage(Arc::clone(&runtime_registry))
            .manage(Arc::clone(&projection_registry))
            .manage(Arc::clone(&transcript_registry))
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let mut result = found_result("session-1", 42);
        let SessionOpenResult::Found(found) = &mut result else {
            panic!("fixture must be found");
        };
        found.last_event_seq = 71;
        found.transcript_snapshot.revision = 7;

        restore_session_open_authority(&app.handle(), &result).await;

        let graph = runtime_registry
            .graph_for_session("session-1")
            .expect("found open must install the held reconnect graph");
        assert_eq!(graph.revision.graph_revision, 42);
        assert_eq!(graph.revision.transcript_revision, 7);
        assert_eq!(graph.revision.last_event_seq, 71);
        assert_eq!(graph.lifecycle.status, LifecycleStatus::Reconnecting);
        assert_eq!(graph.message_count, 1);
    }

    #[tokio::test]
    async fn restore_session_open_authority_does_not_downgrade_ready_runtime_lifecycle() {
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
            .manage(Arc::clone(&projection_registry))
            .manage(Arc::clone(&transcript_registry))
            .build(mock_context(noop_assets()))
            .expect("mock app");

        restore_session_open_authority(&app.handle(), &found_result("session-1", 42)).await;

        let snapshot = runtime_registry.snapshot_for_session("session-1");
        assert_eq!(snapshot.graph_revision, 99);
        assert_eq!(snapshot.lifecycle.status, LifecycleStatus::Ready);
        let graph = runtime_registry
            .graph_for_session("session-1")
            .expect("ready runtime authority must seed the missing held graph");
        assert_eq!(graph.revision.graph_revision, 42);
        assert_eq!(graph.lifecycle.status, LifecycleStatus::Ready);
    }

    #[tokio::test]
    async fn restore_session_open_authority_does_not_replace_existing_held_graph() {
        let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::new());
        let mut ready_result = found_result("session-1", 99);
        let SessionOpenResult::Found(ready_found) = &mut ready_result else {
            panic!("fixture must be found");
        };
        ready_found.lifecycle = SessionGraphLifecycle::ready();
        ready_found.message_count = 9;
        runtime_registry.seed_graph(
            "session-1".to_string(),
            crate::acp::session_state_engine::build_graph_from_open_found(ready_found),
        );
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
            .manage(Arc::clone(&projection_registry))
            .manage(Arc::clone(&transcript_registry))
            .build(mock_context(noop_assets()))
            .expect("mock app");

        restore_session_open_authority(&app.handle(), &found_result("session-1", 42)).await;

        let graph = runtime_registry
            .graph_for_session("session-1")
            .expect("existing held graph must remain installed");
        assert_eq!(graph.revision.graph_revision, 99);
        assert_eq!(graph.lifecycle.status, LifecycleStatus::Ready);
        assert_eq!(graph.message_count, 9);
        let projection = projection_registry
            .snapshot_for_session("session-1")
            .expect("projection mirrors the winning graph");
        assert_eq!(projection.last_event_seq, 99);
        assert_eq!(projection.message_count, 9);
        let transcript = transcript_registry
            .snapshot_for_session("session-1")
            .expect("transcript mirrors the winning graph");
        assert_eq!(transcript.revision, 99);
    }

    #[tokio::test]
    async fn restore_session_open_authority_merges_reconnect_control_plane_into_existing_graph() {
        let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::new());
        let mut detached_result = found_result("session-1", 80);
        let SessionOpenResult::Found(detached_found) = &mut detached_result else {
            panic!("fixture must be found");
        };
        detached_found.lifecycle = SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::ReconnectExhausted,
        );
        detached_found.message_count = 9;
        runtime_registry.seed_graph(
            "session-1".to_string(),
            crate::acp::session_state_engine::build_graph_from_open_found(detached_found),
        );
        runtime_registry.restore_session_state(
            "session-1".to_string(),
            80,
            detached_found.lifecycle.clone(),
            SessionGraphCapabilities::empty(),
        );
        let projection_registry = Arc::new(crate::acp::projections::ProjectionRegistry::new());
        let transcript_registry =
            Arc::new(crate::acp::transcript_projection::TranscriptProjectionRegistry::new());
        let app = mock_builder()
            .manage(Arc::clone(&runtime_registry))
            .manage(Arc::clone(&projection_registry))
            .manage(Arc::clone(&transcript_registry))
            .build(mock_context(noop_assets()))
            .expect("mock app");

        restore_session_open_authority(&app.handle(), &found_result("session-1", 80)).await;

        let graph = runtime_registry
            .graph_for_session("session-1")
            .expect("existing held graph should remain installed");
        assert_eq!(graph.message_count, 9);
        assert_eq!(graph.lifecycle.status, LifecycleStatus::Reconnecting);
        let checkpoint = runtime_registry.snapshot_for_session("session-1");
        assert_eq!(checkpoint.lifecycle.status, LifecycleStatus::Reconnecting);
    }

    fn found_result(session_id: &str, graph_revision: i64) -> SessionOpenResult {
        SessionOpenResult::Found(Box::new(SessionOpenFound {
            requested_session_id: session_id.to_string(),
            canonical_session_id: session_id.to_string(),
            is_alias: false,
            last_event_seq: graph_revision,
            graph_revision,
            open_token: "open-token".to_string(),
            agent_id: CanonicalAgentId::Codex,
            project_path: "/repo".to_string(),
            worktree_path: None,
            source_path: None,
            sequence_id: Some(119),
            transcript_snapshot: TranscriptSnapshot {
                revision: graph_revision,
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
