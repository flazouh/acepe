use std::sync::Arc;

use crate::acp::provider::{HistoryReplayFamily, ProviderHistoryLoadError};
use crate::acp::registry::AgentRegistry;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_open_snapshot::SessionOpenError;
use crate::acp::session_thread_snapshot::ProviderOwnedSessionSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;
use tauri::{AppHandle, Manager};

use super::metadata::{
    apply_provider_derived_current_mode_metadata, apply_provider_session_title_metadata,
};

pub fn session_open_error_from_provider_load(
    requested_session_id: &str,
    error: ProviderHistoryLoadError,
) -> SessionOpenError {
    match error {
        ProviderHistoryLoadError::ProviderUnavailable { message } => {
            SessionOpenError::provider_unavailable(requested_session_id, message)
        }
        ProviderHistoryLoadError::ProviderHistoryMissing { message } => {
            SessionOpenError::provider_history_missing(requested_session_id, message)
        }
        ProviderHistoryLoadError::ProviderUnparseable { message } => {
            SessionOpenError::provider_unparseable(requested_session_id, message)
        }
        ProviderHistoryLoadError::ProviderValidationFailed { message } => {
            SessionOpenError::provider_validation_failed(requested_session_id, message)
        }
        ProviderHistoryLoadError::StaleLineageRecovery { message } => {
            SessionOpenError::stale_lineage_recovery(requested_session_id, message)
        }
        ProviderHistoryLoadError::Internal { message } => {
            SessionOpenError::internal(requested_session_id, message)
        }
    }
}

pub fn history_replay_family(agent: &CanonicalAgentId) -> HistoryReplayFamily {
    crate::acp::parsers::provider_capabilities::provider_capabilities(
        crate::acp::parsers::AgentType::from_canonical(agent),
    )
    .history_replay_policy
    .family
}

async fn load_unified_session_content_with_context(
    app: AppHandle,
    context: crate::history::session_context::SessionContext,
) -> Result<Option<ProviderOwnedSessionSnapshot>, ProviderHistoryLoadError> {
    tracing::info!(
        session_id = %context.local_session_id,
        agent_id = %context.agent_id,
        compatibility = ?context.compatibility,
        "Loading unified session"
    );

    let replay_context = context.replay_context();
    let registry = app.state::<Arc<AgentRegistry>>();
    let provider = registry.get(&context.agent_id);

    let replay_family = provider
        .as_ref()
        .map(|provider| provider.history_replay_policy().family)
        .unwrap_or_else(|| history_replay_family(&context.agent_id));

    let result = match replay_family {
        HistoryReplayFamily::ProviderOwned => match provider {
            Some(provider) => {
                provider
                    .load_provider_owned_session(&app, &context, &replay_context)
                    .await?
            }
            None => {
                return Err(ProviderHistoryLoadError::provider_unavailable(format!(
                    "Provider {} is unavailable for provider-owned session load",
                    context.agent_id
                )));
            }
        },
        HistoryReplayFamily::SharedCanonical => None,
    };

    Ok(result
        .map(apply_provider_derived_current_mode_metadata)
        .map(|session| {
            apply_provider_session_title_metadata(session, context.session_metadata.as_ref())
        }))
}

pub async fn load_provider_owned_session_snapshot(
    app: AppHandle,
    replay_context: &SessionReplayContext,
) -> Result<Option<ProviderOwnedSessionSnapshot>, ProviderHistoryLoadError> {
    let Some(db) = app.try_state::<DbConn>().map(|s| s.inner().clone()) else {
        return Err(ProviderHistoryLoadError::provider_unavailable(
            "Database unavailable for provider-owned session load",
        ));
    };
    let session_metadata =
        SessionMetadataRepository::get_by_id(&db, &replay_context.local_session_id)
            .await
            .map_err(|error| {
                ProviderHistoryLoadError::internal(format!(
                    "Failed to load session metadata for {}: {error}",
                    replay_context.local_session_id
                ))
            })?;

    let context = crate::history::session_context::SessionContext {
        local_session_id: replay_context.local_session_id.clone(),
        history_session_id: replay_context.history_session_id.clone(),
        project_path: replay_context.project_path.clone(),
        worktree_path: replay_context.worktree_path.clone(),
        effective_project_path: replay_context.effective_cwd.clone(),
        source_path: replay_context.source_path.clone(),
        agent_id: replay_context.agent_id.clone(),
        compatibility: replay_context.compatibility.clone(),
        session_metadata,
    };
    load_unified_session_content_with_context(app, context).await
}

#[cfg(test)]
mod tests {
    use super::{history_replay_family, session_open_error_from_provider_load};
    use crate::acp::provider::{HistoryReplayFamily, ProviderHistoryLoadError};
    use crate::acp::session_open_snapshot::SessionOpenErrorReason;
    use crate::acp::types::CanonicalAgentId;

    #[test]
    fn builtin_history_dispatch_uses_provider_owned_policy() {
        for agent in [
            CanonicalAgentId::ClaudeCode,
            CanonicalAgentId::Copilot,
            CanonicalAgentId::OpenCode,
            CanonicalAgentId::Cursor,
            CanonicalAgentId::Codex,
        ] {
            assert_eq!(
                history_replay_family(&agent),
                HistoryReplayFamily::ProviderOwned
            );
        }
    }

    #[test]
    fn provider_history_parse_failures_are_non_retryable_unparseable_errors() {
        let error = session_open_error_from_provider_load(
            "session-1",
            ProviderHistoryLoadError::provider_unparseable(
                "Claude provider history parse failed: invalid JSON",
            ),
        );

        assert!(matches!(
            error.reason,
            SessionOpenErrorReason::ProviderUnparseable
        ));
        assert!(!error.retryable);
    }

    #[test]
    fn provider_history_restore_failures_have_specific_taxonomy() {
        let missing = session_open_error_from_provider_load(
            "session-1",
            ProviderHistoryLoadError::provider_history_missing(
                "provider history missing for provider session",
            ),
        );
        assert!(matches!(
            missing.reason,
            SessionOpenErrorReason::ProviderHistoryMissing
        ));
        assert!(!missing.retryable);

        let unavailable = session_open_error_from_provider_load(
            "session-1",
            ProviderHistoryLoadError::provider_unavailable(
                "provider unavailable while loading history",
            ),
        );
        assert!(matches!(
            unavailable.reason,
            SessionOpenErrorReason::ProviderUnavailable
        ));
        assert!(unavailable.retryable);

        let validation = session_open_error_from_provider_load(
            "session-1",
            ProviderHistoryLoadError::provider_validation_failed(
                "provider history validation failed: invalid provenance",
            ),
        );
        assert!(matches!(
            validation.reason,
            SessionOpenErrorReason::ProviderValidationFailed
        ));
        assert!(!validation.retryable);
    }

    #[test]
    fn provider_history_load_failures_use_explicit_internal_errors() {
        let error = session_open_error_from_provider_load(
            "session-1",
            ProviderHistoryLoadError::internal(
                "Copilot provider history load failed: transport timeout",
            ),
        );

        assert!(matches!(error.reason, SessionOpenErrorReason::Internal));
        assert!(error.retryable);
    }
}
