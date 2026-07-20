use super::super::*;
use super::*;

pub(crate) fn session_metadata_context_from_cwd(cwd: &std::path::Path) -> (String, Option<String>) {
    // Use the runtime root resolver to walk up from cwd and find the
    // actual repo/worktree root.  This fixes the bug where a subdirectory
    // like /repo/src/components/ was persisted as the project_path.
    match crate::acp::opencode::runtime_root::resolve(cwd) {
        Ok(resolved) => {
            let main_repo = resolved.project_root.to_string_lossy().into_owned();
            let runtime = resolved.runtime_root.to_string_lossy().into_owned();

            if main_repo != runtime {
                // Worktree: project_path is the main repo, worktree_path is the worktree root.
                (main_repo, Some(runtime))
            } else {
                // Regular repo or non-git directory: project_path is the resolved root.
                (runtime, None)
            }
        }
        Err(_) => {
            // Fallback: resolver failed (e.g. path doesn't exist).
            // Use the canonical cwd as-is, preserving the old behavior for
            // edge cases like non-existent paths passed during cleanup.
            let canonical_cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
            (canonical_cwd.to_string_lossy().into_owned(), None)
        }
    }
}

pub(crate) async fn persist_session_metadata_for_cwd(
    db: &DbConn,
    session_id: &str,
    agent_id: &CanonicalAgentId,
    cwd: &std::path::Path,
) -> Result<Option<i32>, SerializableAcpError> {
    let (project_path, worktree_path) = session_metadata_context_from_cwd(cwd);

    let sequence_id = SessionMetadataRepository::ensure_exists_and_promote(
        db,
        session_id,
        &project_path,
        agent_id.as_str(),
        worktree_path.as_deref(),
    )
    .await
    .map_err(|error| SerializableAcpError::InvalidState {
        message: format!("Failed to persist session metadata for session {session_id}: {error}"),
    })?;

    ensure_session_anchor_snapshots(db, session_id, agent_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to persist canonical session anchors for session {session_id}: {error}"
            ),
        })?;

    Ok(sequence_id)
}

pub(crate) fn validate_provider_session_id_for_creation(
    session_id: &str,
) -> Result<(), SerializableAcpError> {
    const MAX_PROVIDER_SESSION_ID_LEN: usize = 256;
    if session_id.is_empty() {
        return Err(creation_failure(
            CreationFailureKind::InvalidProviderSessionId,
            "Provider returned an empty session id",
            None,
            None,
            false,
        ));
    }
    if session_id.len() > MAX_PROVIDER_SESSION_ID_LEN {
        return Err(creation_failure(
            CreationFailureKind::InvalidProviderSessionId,
            format!(
                "Provider returned an oversized session id ({} bytes)",
                session_id.len()
            ),
            Some(session_id.to_string()),
            None,
            false,
        ));
    }
    let is_allowed = session_id.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':')
    });
    if !is_allowed {
        return Err(creation_failure(
            CreationFailureKind::InvalidProviderSessionId,
            "Provider returned a session id with disallowed characters",
            Some(session_id.to_string()),
            None,
            false,
        ));
    }
    Ok(())
}

pub(super) fn creation_failure(
    kind: CreationFailureKind,
    message: impl Into<String>,
    session_id: Option<String>,
    creation_attempt_id: Option<String>,
    retryable: bool,
) -> SerializableAcpError {
    SerializableAcpError::CreationFailed(CreationFailure::new(
        kind,
        message,
        session_id,
        creation_attempt_id,
        retryable,
    ))
}

/// Build a creation failure whose canonical [`FailureReason`] is taken from the
/// underlying activation error when it has a cross-cutting meaning shared with
/// the resume path (e.g. `AuthenticationRequired`, `SessionGoneUpstream`),
/// falling back to the creation-kind default otherwise.
///
/// This is the seam that keeps a single classification authority across the
/// new-session and resume paths: the same root error yields the same canonical
/// `FailureReason`, so the panel renders the same lifecycle-driven card instead
/// of a parallel raw-message page.
pub(super) fn creation_failure_classified(
    kind: CreationFailureKind,
    source: &SerializableAcpError,
    session_id: Option<String>,
    creation_attempt_id: Option<String>,
    retryable: bool,
) -> SerializableAcpError {
    let mut failure = CreationFailure::new(
        kind,
        source.to_string(),
        session_id,
        creation_attempt_id,
        retryable,
    );
    if let Some(failure_reason) =
        crate::acp::resume_failure_classifier::cross_cutting_failure_reason(source)
    {
        failure = failure.with_failure_reason(failure_reason);
    }
    SerializableAcpError::CreationFailed(failure)
}

pub(super) async fn mark_creation_attempt_failed(db: &DbConn, attempt_id: &str, reason: &str) {
    if let Err(error) =
        SessionMetadataRepository::fail_creation_attempt(db, attempt_id, reason).await
    {
        tracing::warn!(
            attempt_id = %attempt_id,
            error = %error,
            "Failed to mark creation attempt failed"
        );
    }
}

pub(super) async fn ensure_session_anchor_snapshots(
    _db: &DbConn,
    _session_id: &str,
    _agent_id: &CanonicalAgentId,
) -> anyhow::Result<()> {
    Ok(())
}

pub(super) async fn resolve_resume_session_target(
    db: &DbConn,
    session_registry: Option<&SessionRegistry>,
    session_id: &str,
    requested_cwd: &str,
    explicit_agent_id: Option<&str>,
) -> Result<ResolvedResumeSession, SerializableAcpError> {
    let metadata = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Failed to load session metadata for resume: {error}"),
        })?;

    let explicit_agent_override = explicit_agent_id.map(CanonicalAgentId::parse);

    if metadata
        .as_ref()
        .is_some_and(|row| row.is_transcript_pending())
        && session_registry.is_some_and(|registry| registry.contains(session_id))
    {
        return resolve_live_pending_session_resume(
            metadata
                .as_ref()
                .expect("checked metadata presence above")
                .descriptor_facts(),
            requested_cwd,
            explicit_agent_override.clone(),
        )
        .map_err(SerializableAcpError::from);
    }

    SessionMetadataRepository::resolve_existing_session_resume_from_metadata(
        session_id,
        metadata.as_ref(),
        requested_cwd,
        explicit_agent_override,
    )
    .map_err(SerializableAcpError::from)
}

pub(crate) fn resolve_requested_agent_id(
    explicit_agent_id: Option<&str>,
    active_agent_id: Option<CanonicalAgentId>,
) -> CanonicalAgentId {
    explicit_agent_id
        .map(CanonicalAgentId::parse)
        .or(active_agent_id)
        .unwrap_or(CanonicalAgentId::ClaudeCode)
}

pub(super) async fn resolve_fork_session_target(
    db: &DbConn,
    session_id: &str,
    requested_cwd: &str,
    explicit_agent_id: Option<&str>,
) -> Result<ResolvedForkSession, SerializableAcpError> {
    let metadata = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Failed to load session metadata for fork: {error}"),
        })?;

    let Some(metadata) = metadata.as_ref() else {
        return Err(SerializableAcpError::SessionNotFound {
            session_id: session_id.to_string(),
        });
    };

    crate::acp::session_descriptor::resolve_existing_session_fork(
        metadata.descriptor_facts(),
        requested_cwd,
        explicit_agent_id.map(CanonicalAgentId::parse),
    )
    .map_err(SerializableAcpError::from)
}

#[cfg(test)]
mod creation_failure_classification_tests {
    use super::creation_failure_classified;
    use crate::acp::error::{CreationFailureKind, SerializableAcpError};
    use crate::acp::lifecycle::FailureReason;

    fn classified_reason(source: &SerializableAcpError) -> FailureReason {
        match creation_failure_classified(
            CreationFailureKind::ProviderFailedBeforeId,
            source,
            None,
            Some("attempt-1".to_string()),
            true,
        ) {
            SerializableAcpError::CreationFailed(failure) => failure.failure_reason,
            other => panic!("expected CreationFailed, got {other:?}"),
        }
    }

    #[test]
    fn auth_required_creation_failure_falls_back_to_activation_failed() {
        // Auth errors bypass cross-cutting classification and route to
        // SessionDetached { AwaitingAuthentication } at the activation layer.
        // CreationFailed therefore keeps the kind default.
        let source = SerializableAcpError::AuthenticationRequired {
            agent: "Cursor".to_string(),
            instructions: "Run `agent login`.".to_string(),
        };
        assert_eq!(classified_reason(&source), FailureReason::ActivationFailed);
    }

    #[test]
    fn session_gone_creation_failure_carries_session_gone_upstream_reason() {
        let source = SerializableAcpError::SessionNotFound {
            session_id: "abc".to_string(),
        };
        assert_eq!(
            classified_reason(&source),
            FailureReason::SessionGoneUpstream
        );
    }

    #[test]
    fn non_cross_cutting_creation_failure_falls_back_to_kind_default() {
        // A generic provider fault has no cross-cutting meaning, so it keeps
        // the creation-kind default (ProviderFailedBeforeId -> ActivationFailed).
        let source = SerializableAcpError::ClientNotStarted;
        assert_eq!(classified_reason(&source), FailureReason::ActivationFailed);
    }
}
