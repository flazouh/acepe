use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::envelope::SessionStateEnvelope;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeRegistry, VisibleTranscriptWindowMiss,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::commands::observability::{CommandResult, expected_acp_command_result};
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
                                "Transcript rows envelope exceeded the byte budget for session {session_id}"
                            ),
                        }
                    }
                })
        }
        .await,
    )
}
