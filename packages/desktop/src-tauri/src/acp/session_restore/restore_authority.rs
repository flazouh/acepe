use std::sync::Arc;

use crate::acp::projections::{
    is_terminal_operation_state, ProjectionRegistry, SessionProjectionSnapshot, SessionSnapshot,
};
use crate::acp::session_open_snapshot::SessionOpenResult;
use crate::acp::transcript_projection::{
    assistant_boundary_entry_count_from_transcript_entries, TranscriptProjectionRegistry,
};
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

    if let Some(projection_registry) = app.try_state::<Arc<ProjectionRegistry>>() {
        let session = SessionSnapshot {
            session_id: canonical_session_id.clone(),
            agent_id: Some(found.agent_id.clone()),
            last_event_seq: found.last_event_seq,
            turn_state: found.turn_state.clone(),
            message_count: found.message_count,
            active_tool_call_ids: Vec::new(),
            completed_tool_call_ids: found
                .operations
                .iter()
                .filter(|operation| is_terminal_operation_state(&operation.operation_state))
                .map(|operation| operation.tool_call_id.clone())
                .collect(),
            active_turn_failure: found.active_turn_failure.clone(),
            last_terminal_turn_id: found.last_terminal_turn_id.clone(),
            assistant_boundary_entry_count: assistant_boundary_entry_count_from_transcript_entries(
                &found.transcript_snapshot.entries,
            ),
            transcript_entry_count: found.transcript_snapshot.entries.len(),
        };
        projection_registry
            .inner()
            .restore_session_projection(SessionProjectionSnapshot {
                session: Some(session),
                operations: found.operations.clone(),
                interactions: found.interactions.clone(),
                runtime: None,
            });
    }
}
