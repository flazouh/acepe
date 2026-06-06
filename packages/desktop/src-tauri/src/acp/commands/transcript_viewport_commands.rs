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

struct TranscriptViewportCommandInput {
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    viewport_height_px: u32,
    scroll_intent: Option<ScrollIntent>,
    height_confirmation: Option<TranscriptViewportHeightConfirmation>,
    request_generation: Option<u64>,
    force_fresh: bool,
}

fn build_buffer_envelope_for_command(
    app: &AppHandle,
    input: TranscriptViewportCommandInput,
) -> Result<Option<SessionStateEnvelope>, crate::acp::error::SerializableAcpError> {
    let runtime_registry = app.state::<Arc<SessionGraphRuntimeRegistry>>();
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();

    runtime_registry
        .build_or_advance_viewport_buffer_envelope(
            &input.session_id,
            input.revision.into(),
            &projection_registry,
            &transcript_projection_registry,
            Some(input.viewport_height_px),
            input.scroll_intent,
            input.height_confirmation,
            input.request_generation,
            input.force_fresh,
        )
        .map_err(|miss| match miss {
            VisibleTranscriptWindowMiss::SessionNotAttached => {
                crate::acp::error::SerializableAcpError::ViewportSessionNotAttached {
                    session_id: input.session_id,
                }
            }
            VisibleTranscriptWindowMiss::BudgetExceeded => {
                crate::acp::error::SerializableAcpError::InvalidState {
                    message: format!(
                        "Transcript viewport envelope exceeded the byte budget for session {}",
                        input.session_id
                    ),
                }
            }
        })
}

#[tauri::command]
#[specta::specta]
pub async fn acp_request_transcript_viewport_buffer(
    app: AppHandle,
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    request_generation: Option<u64>,
) -> CommandResult<Option<SessionStateEnvelope>> {
    expected_acp_command_result(
        "acp_request_transcript_viewport_buffer",
        async move {
            let runtime_registry = app.state::<Arc<SessionGraphRuntimeRegistry>>();
            let projection_registry = app.state::<Arc<ProjectionRegistry>>();
            let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
            runtime_registry
                .build_or_advance_viewport_buffer_envelope(
                    &session_id,
                    revision.into(),
                    &projection_registry,
                    &transcript_projection_registry,
                    None,
                    None,
                    None,
                    request_generation,
                    true,
                )
                .map_err(|miss| match miss {
                    VisibleTranscriptWindowMiss::SessionNotAttached => {
                        crate::acp::error::SerializableAcpError::ViewportSessionNotAttached {
                            session_id,
                        }
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
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn acp_scroll_transcript_viewport(
    app: AppHandle,
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    viewport_height_px: u32,
    offset_px: u64,
    request_generation: Option<u64>,
    force_fresh: Option<bool>,
) -> CommandResult<Option<SessionStateEnvelope>> {
    expected_acp_command_result(
        "acp_scroll_transcript_viewport",
        async move {
            build_buffer_envelope_for_command(
                &app,
                TranscriptViewportCommandInput {
                    session_id,
                    revision,
                    viewport_height_px,
                    scroll_intent: Some(ScrollIntent::DetachAtOffset { offset_px }),
                    height_confirmation: None,
                    request_generation,
                    force_fresh: force_fresh.unwrap_or(false),
                },
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
    request_generation: Option<u64>,
) -> CommandResult<Option<SessionStateEnvelope>> {
    expected_acp_command_result(
        "acp_reveal_transcript_viewport_row",
        async move {
            let scroll_intent = match row_id {
                Some(row_id) => Some(ScrollIntent::RevealRow { row_id }),
                None => Some(ScrollIntent::FollowTail),
            };
            build_buffer_envelope_for_command(
                &app,
                TranscriptViewportCommandInput {
                    session_id,
                    revision,
                    viewport_height_px,
                    scroll_intent,
                    height_confirmation: None,
                    request_generation,
                    force_fresh: true,
                },
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
    request_generation: Option<u64>,
) -> CommandResult<Option<SessionStateEnvelope>> {
    expected_acp_command_result(
        "acp_resize_transcript_viewport",
        async move {
            build_buffer_envelope_for_command(
                &app,
                TranscriptViewportCommandInput {
                    session_id,
                    revision,
                    viewport_height_px,
                    scroll_intent: None,
                    height_confirmation: None,
                    request_generation,
                    force_fresh: false,
                },
            )
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn acp_confirm_transcript_viewport_height(
    app: AppHandle,
    session_id: String,
    revision: TranscriptViewportCommandRevision,
    viewport_height_px: u32,
    row_id: String,
    row_version: String,
    height_px: u32,
    viewport_offset_px: Option<u64>,
    request_generation: Option<u64>,
) -> CommandResult<Option<SessionStateEnvelope>> {
    expected_acp_command_result(
        "acp_confirm_transcript_viewport_height",
        async move {
            build_buffer_envelope_for_command(
                &app,
                TranscriptViewportCommandInput {
                    session_id,
                    revision,
                    viewport_height_px,
                    scroll_intent: None,
                    height_confirmation: Some(TranscriptViewportHeightConfirmation {
                        row_id,
                        row_version,
                        height_px,
                        viewport_offset_px,
                    }),
                    request_generation,
                    force_fresh: false,
                },
            )
        }
        .await,
    )
}
