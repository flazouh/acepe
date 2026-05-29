use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::envelope::SessionStateEnvelope;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeRegistry, TranscriptViewportHeightConfirmation, VisibleTranscriptWindowMiss,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::acp::transcript_viewport::ScrollIntent;
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptViewportCommandRevision {
    pub graph_revision: i64,
    pub transcript_revision: i64,
    pub last_event_seq: i64,
}

impl From<TranscriptViewportCommandRevision> for SessionGraphRevision {
    fn from(value: TranscriptViewportCommandRevision) -> Self {
        Self {
            graph_revision: value.graph_revision,
            transcript_revision: value.transcript_revision,
            last_event_seq: value.last_event_seq,
        }
    }
}

fn build_visible_window_for_command(
    app: &AppHandle,
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    viewport_height_px: u32,
    scroll_intent: Option<ScrollIntent>,
    height_confirmation: Option<TranscriptViewportHeightConfirmation>,
) -> Result<SessionStateEnvelope, crate::acp::error::SerializableAcpError> {
    let runtime_registry = app.state::<Arc<SessionGraphRuntimeRegistry>>();
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();

    runtime_registry
        .build_visible_transcript_window_envelope_for_session(
            &session_id,
            revision.into(),
            &projection_registry,
            &transcript_projection_registry,
            viewport_height_px,
            scroll_intent,
            height_confirmation,
        )
        .map_err(|miss| match miss {
            VisibleTranscriptWindowMiss::SessionNotAttached => {
                crate::acp::error::SerializableAcpError::ViewportSessionNotAttached { session_id }
            }
            VisibleTranscriptWindowMiss::BudgetExceeded => {
                crate::acp::error::SerializableAcpError::InvalidState {
                    message: format!(
                        "Transcript viewport envelope exceeded the byte budget for session {session_id}"
                    ),
                }
            }
        })
}

#[tauri::command]
#[specta::specta]
pub async fn acp_scroll_transcript_viewport(
    app: AppHandle,
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    viewport_height_px: u32,
    offset_px: u64,
) -> CommandResult<SessionStateEnvelope> {
    expected_acp_command_result(
        "acp_scroll_transcript_viewport",
        async move {
            build_visible_window_for_command(
                &app,
                session_id,
                revision,
                viewport_height_px,
                Some(ScrollIntent::DetachAtOffset { offset_px }),
                None,
            )
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn acp_reveal_transcript_viewport_row(
    app: AppHandle,
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    viewport_height_px: u32,
    row_id: Option<String>,
) -> CommandResult<SessionStateEnvelope> {
    expected_acp_command_result(
        "acp_reveal_transcript_viewport_row",
        async move {
            let scroll_intent = match row_id {
                Some(row_id) => Some(ScrollIntent::RevealRow { row_id }),
                None => Some(ScrollIntent::FollowTail),
            };
            build_visible_window_for_command(
                &app,
                session_id,
                revision,
                viewport_height_px,
                scroll_intent,
                None,
            )
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn acp_resize_transcript_viewport(
    app: AppHandle,
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    viewport_height_px: u32,
) -> CommandResult<SessionStateEnvelope> {
    expected_acp_command_result(
        "acp_resize_transcript_viewport",
        async move {
            build_visible_window_for_command(
                &app,
                session_id,
                revision,
                viewport_height_px,
                None,
                None,
            )
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn acp_confirm_transcript_viewport_height(
    app: AppHandle,
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    viewport_height_px: u32,
    row_id: String,
    row_version: String,
    height_px: u32,
) -> CommandResult<SessionStateEnvelope> {
    expected_acp_command_result(
        "acp_confirm_transcript_viewport_height",
        async move {
            build_visible_window_for_command(
                &app,
                session_id,
                revision,
                viewport_height_px,
                None,
                Some(TranscriptViewportHeightConfirmation {
                    row_id,
                    row_version,
                    height_px,
                }),
            )
        }
        .await,
    )
}
