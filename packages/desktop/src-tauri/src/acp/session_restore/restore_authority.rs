use std::sync::Arc;

use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_open_snapshot::{
    session_projection_snapshot_from_open_found, SessionOpenResult,
};
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

    if let Some(projection_registry) = app.try_state::<Arc<ProjectionRegistry>>() {
        projection_registry
            .inner()
            .restore_session_projection(session_projection_snapshot_from_open_found(found));
    }
}
