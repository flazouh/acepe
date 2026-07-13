use std::sync::Arc;

use crate::acp::provider::{HistoryReplayFamily, ProviderHistoryLoadError};
use crate::acp::registry::AgentRegistry;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_open_snapshot::SessionOpenError;
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;
use tauri::{AppHandle, Manager};

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

pub(crate) async fn load_provider_history_events_with_context(
    app: AppHandle,
    context: crate::history::session_context::SessionContext,
) -> Result<Option<Vec<ProviderEvent>>, ProviderHistoryLoadError> {
    tracing::info!(
        session_id = %context.local_session_id,
        agent_id = %context.agent_id,
        compatibility = ?context.compatibility,
        "Loading provider history events"
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
                    .load_provider_history_events(&app, &context, &replay_context)
                    .await?
            }
            None => {
                return Err(ProviderHistoryLoadError::provider_unavailable(format!(
                    "Provider {} is unavailable for provider history load",
                    context.agent_id
                )));
            }
        },
        HistoryReplayFamily::SharedCanonical => None,
    };

    Ok(result)
}

pub async fn load_provider_history_events_from_provider(
    app: AppHandle,
    replay_context: &SessionReplayContext,
) -> Result<Option<Vec<ProviderEvent>>, ProviderHistoryLoadError> {
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

    let context = session_context_from_replay(replay_context, session_metadata);
    load_provider_history_events_with_context(app, context).await
}

fn session_context_from_replay(
    replay_context: &SessionReplayContext,
    session_metadata: Option<crate::db::repository::SessionMetadataRow>,
) -> crate::history::session_context::SessionContext {
    crate::history::session_context::SessionContext {
        local_session_id: replay_context.local_session_id.clone(),
        history_session_id: replay_context.history_session_id.clone(),
        project_path: replay_context.project_path.clone(),
        worktree_path: replay_context.worktree_path.clone(),
        effective_project_path: if replay_context.effective_cwd.trim().is_empty() {
            replay_context.project_path.clone()
        } else {
            replay_context.effective_cwd.clone()
        },
        source_path: replay_context.source_path.clone(),
        agent_id: replay_context.agent_id.clone(),
        compatibility: replay_context.compatibility.clone(),
        session_metadata,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        history_replay_family, session_context_from_replay, session_open_error_from_provider_load,
    };
    use crate::acp::provider::{HistoryReplayFamily, ProviderHistoryLoadError};
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
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

    #[test]
    fn provider_history_context_preserves_source_path_and_effective_cwd_fallback() {
        let mut replay_context = SessionReplayContext {
            local_session_id: "local-1".to_string(),
            history_session_id: "provider-1".to_string(),
            agent_id: CanonicalAgentId::ClaudeCode,
            parser_agent_type: crate::acp::parsers::AgentType::ClaudeCode,
            project_path: "/project".to_string(),
            worktree_path: Some("/worktree".to_string()),
            effective_cwd: String::new(),
            source_path: Some("/history/session.jsonl".to_string()),
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        let fallback = session_context_from_replay(&replay_context, None);
        assert_eq!(fallback.effective_project_path, "/project");
        assert_eq!(
            fallback.source_path.as_deref(),
            Some("/history/session.jsonl")
        );

        replay_context.effective_cwd = "/worktree".to_string();
        let effective = session_context_from_replay(&replay_context, None);
        assert_eq!(effective.effective_project_path, "/worktree");
    }
}
