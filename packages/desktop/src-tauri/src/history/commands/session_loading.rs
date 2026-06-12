use super::*;
use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::OperationSnapshot;
use crate::acp::projections::OperationSourceLink;
use crate::acp::projections::ProjectionRegistry;
use crate::acp::projections::SessionProjectionSnapshot;
use crate::acp::projections::SessionSnapshot;
use crate::acp::provider::{HistoryReplayFamily, ProviderHistoryLoadError};
use crate::acp::registry::AgentRegistry;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_open_snapshot::{
    session_open_result_from_completed_local_journal, SessionOpenError, SessionOpenMissing,
    SessionOpenResult,
};
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::transcript_projection::assistant_boundary_entry_count_from_transcript_entries;
use crate::acp::transcript_projection::TranscriptEntryRole;
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::acp::transcript_projection::TranscriptSegment;
use crate::acp::transcript_projection::TranscriptSnapshot;
use crate::commands::observability::{
    unexpected_command_result, CommandResult, SerializableCommandError,
};
use crate::db::repository::SessionMetadataRepository;
use crate::opencode_history::commands::fetch_opencode_session;
use sea_orm::DbConn;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;

fn canonicalize_persisted_worktree_path(worktree_path: &str) -> Result<std::path::PathBuf, String> {
    let canonical = std::path::Path::new(worktree_path)
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize worktree path: {}", e))?;

    if !canonical.is_dir() {
        return Err("Worktree path is not a directory".to_string());
    }

    if !canonical.join(".git").is_file() {
        return Err("Worktree path does not contain a git worktree .git file".to_string());
    }

    Ok(canonical)
}

fn apply_session_title_metadata(
    mut session: SessionThreadSnapshot,
    metadata: Option<&crate::db::repository::SessionMetadataRow>,
) -> SessionThreadSnapshot {
    if let Some(row) = metadata {
        if row.title_overridden {
            session.title = row.display.clone();
        }
    }

    session
}

fn apply_provider_session_title_metadata(
    mut session: ProviderOwnedSessionSnapshot,
    metadata: Option<&crate::db::repository::SessionMetadataRow>,
) -> ProviderOwnedSessionSnapshot {
    session.thread_snapshot = apply_session_title_metadata(session.thread_snapshot, metadata);
    session
}

fn derive_current_mode_id_from_entries(
    entries: &[crate::session_jsonl::types::StoredEntry],
) -> Option<String> {
    let mut current_mode_id: Option<String> = None;

    for entry in entries {
        let crate::session_jsonl::types::StoredEntry::ToolCall { message, .. } = entry else {
            continue;
        };

        let Some(kind) = message.kind else {
            continue;
        };

        match kind {
            crate::acp::session_update::ToolKind::EnterPlanMode
                if message.status != crate::acp::session_update::ToolCallStatus::Failed =>
            {
                current_mode_id = Some("plan".to_string());
            }
            crate::acp::session_update::ToolKind::ExitPlanMode
                if message.status == crate::acp::session_update::ToolCallStatus::Completed =>
            {
                current_mode_id = Some("build".to_string());
            }
            _ => {}
        }
    }

    current_mode_id
}

fn apply_derived_current_mode_metadata(
    mut session: SessionThreadSnapshot,
) -> SessionThreadSnapshot {
    if session.current_mode_id.is_none() {
        session.current_mode_id = derive_current_mode_id_from_entries(&session.entries);
    }

    session
}

fn apply_provider_derived_current_mode_metadata(
    mut session: ProviderOwnedSessionSnapshot,
) -> ProviderOwnedSessionSnapshot {
    session.thread_snapshot = apply_derived_current_mode_metadata(session.thread_snapshot);
    session
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnresolvedToolRowAudit {
    pub entry_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestoredToolLinkAudit {
    pub session_id: String,
    pub agent_id: String,
    pub entry_count: usize,
    pub transcript_tool_count: usize,
    pub operation_count: usize,
    pub unresolved_count: usize,
    pub unresolved_rows: Vec<UnresolvedToolRowAudit>,
}

pub fn audit_restored_tool_links_from_snapshot(
    session_id: &str,
    agent_id: &CanonicalAgentId,
    snapshot: &SessionThreadSnapshot,
) -> RestoredToolLinkAudit {
    let projection =
        ProjectionRegistry::project_thread_snapshot(session_id, Some(agent_id.clone()), snapshot);
    let transcript_snapshot = TranscriptSnapshot::from_stored_entries(0, &snapshot.entries);
    let unresolved_rows =
        unresolved_tool_rows_for_operations(&transcript_snapshot, &projection.operations);
    let transcript_tool_count = transcript_snapshot
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
        .count();

    RestoredToolLinkAudit {
        session_id: session_id.to_string(),
        agent_id: agent_id.to_string_with_prefix(),
        entry_count: snapshot.entries.len(),
        transcript_tool_count,
        operation_count: projection.operations.len(),
        unresolved_count: unresolved_rows.len(),
        unresolved_rows,
    }
}

fn unresolved_tool_rows_for_operations(
    transcript_snapshot: &TranscriptSnapshot,
    operations: &[OperationSnapshot],
) -> Vec<UnresolvedToolRowAudit> {
    let linked_entry_ids: HashSet<&str> = operations
        .iter()
        .filter_map(|operation| match &operation.source_link {
            OperationSourceLink::TranscriptLinked { entry_id } => Some(entry_id.as_str()),
            OperationSourceLink::Synthetic { .. } | OperationSourceLink::Degraded { .. } => None,
        })
        .collect();

    transcript_snapshot
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
        .filter(|entry| !linked_entry_ids.contains(entry.entry_id.as_str()))
        .map(|entry| UnresolvedToolRowAudit {
            entry_id: entry.entry_id.clone(),
            text: transcript_entry_text(&entry.segments),
        })
        .collect()
}

fn transcript_entry_text(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .map(|segment| match segment {
            TranscriptSegment::Text { text, .. } => text.as_str(),
            TranscriptSegment::Thought { text, .. } => text.as_str(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn audit_restored_tool_links_cli(
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<RestoredToolLinkAudit, String> {
    let canonical_agent = CanonicalAgentId::parse(&agent_id);
    let snapshot = load_thread_snapshot_for_audit_cli(
        &session_id,
        &project_path,
        &canonical_agent,
        source_path,
    )
    .await?;

    let Some(snapshot) = snapshot else {
        return Err(format!(
            "No restored session snapshot found for {session_id}"
        ));
    };

    Ok(audit_restored_tool_links_from_snapshot(
        &session_id,
        &canonical_agent,
        &snapshot,
    ))
}

async fn load_thread_snapshot_for_audit_cli(
    session_id: &str,
    project_path: &str,
    canonical_agent: &CanonicalAgentId,
    source_path: Option<String>,
) -> Result<Option<SessionThreadSnapshot>, String> {
    match canonical_agent {
        CanonicalAgentId::ClaudeCode => {
            let session_path = session_jsonl_parser::find_session_file(session_id, project_path)
                .await
                .map_err(|e| format!("Failed to find Claude session file: {}", e))?;
            let full_session = session_jsonl_parser::parse_full_session_from_path(
                session_id,
                project_path,
                &session_path,
            )
            .await
            .map_err(|e| format!("Failed to parse Claude session: {}", e))?;
            Ok(Some(
                crate::session_converter::convert_claude_full_session_to_thread_snapshot(
                    &full_session,
                ),
            ))
        }
        CanonicalAgentId::Copilot => crate::copilot_history::load_thread_snapshot_from_disk(
            session_id,
            source_path.as_deref(),
            &format!("Session {}", &session_id[..8.min(session_id.len())]),
        )
        .await
        .map(Some)
        .map_err(|e| format!("Failed to parse Copilot session: {}", e)),
        CanonicalAgentId::Cursor => load_cursor_thread_snapshot_for_audit(session_id, source_path)
            .await
            .map_err(|e| format!("Failed to parse Cursor session: {}", e)),
        CanonicalAgentId::OpenCode => {
            opencode_parser::load_thread_snapshot_from_disk(session_id, source_path.as_deref())
                .await
                .map_err(|e| format!("Failed to parse OpenCode session: {}", e))
        }
        CanonicalAgentId::Codex => {
            codex_parser::load_thread_snapshot(session_id, project_path, source_path.as_deref())
                .await
                .map_err(|e| format!("Failed to parse Codex session: {}", e))
        }
        CanonicalAgentId::Forge => Err("Forge audit is not implemented yet".to_string()),
        CanonicalAgentId::Custom(_) => {
            Err("Custom agents do not support restored tool link audit".to_string())
        }
    }
}

async fn load_cursor_thread_snapshot_for_audit(
    session_id: &str,
    source_path: Option<String>,
) -> Result<Option<SessionThreadSnapshot>, anyhow::Error> {
    if let Some(source_path) = source_path {
        if let Ok(Some(full_session)) =
            cursor_parser::load_session_from_source(session_id, &source_path).await
        {
            return Ok(Some(
                crate::session_converter::convert_cursor_full_session_to_thread_snapshot(
                    &full_session,
                ),
            ));
        }
    }

    let full_session = cursor_parser::find_session_by_id(session_id).await?;
    Ok(full_session.map(|session| {
        crate::session_converter::convert_cursor_full_session_to_thread_snapshot(&session)
    }))
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProviderRestoreAuditOutcome {
    RestoredNonEmpty,
    MissingHistory,
    UnparseableHistory,
    ProviderUnavailable,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProvenanceKeyStability {
    Stable,
    Unstable,
    Unknown,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CanonicalSafeWellFormedness {
    WellFormed,
    NotWellFormed,
    Unknown,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderRestoreAuditCase {
    pub(crate) provider_id: String,
    pub(crate) session_id: String,
    pub(crate) outcome: ProviderRestoreAuditOutcome,
    pub(crate) entry_count: usize,
    pub(crate) time_to_first_entry_render_ms: Option<u128>,
    pub(crate) provenance_key_stability: ProvenanceKeyStability,
    pub(crate) canonical_safe_well_formedness: CanonicalSafeWellFormedness,
}

#[cfg(test)]
impl ProviderRestoreAuditCase {
    pub(crate) fn happy_path(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
        entry_count: usize,
        time_to_first_entry_render_ms: u128,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
            outcome: ProviderRestoreAuditOutcome::RestoredNonEmpty,
            entry_count,
            time_to_first_entry_render_ms: Some(time_to_first_entry_render_ms),
            provenance_key_stability: ProvenanceKeyStability::Stable,
            canonical_safe_well_formedness: CanonicalSafeWellFormedness::WellFormed,
        }
    }

    pub(crate) fn missing_history(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
            outcome: ProviderRestoreAuditOutcome::MissingHistory,
            entry_count: 0,
            time_to_first_entry_render_ms: None,
            provenance_key_stability: ProvenanceKeyStability::Unknown,
            canonical_safe_well_formedness: CanonicalSafeWellFormedness::Unknown,
        }
    }

    pub(crate) fn unparseable_history(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
            outcome: ProviderRestoreAuditOutcome::UnparseableHistory,
            entry_count: 0,
            time_to_first_entry_render_ms: None,
            provenance_key_stability: ProvenanceKeyStability::Unknown,
            canonical_safe_well_formedness: CanonicalSafeWellFormedness::Unknown,
        }
    }

    pub(crate) fn provider_unavailable(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
            outcome: ProviderRestoreAuditOutcome::ProviderUnavailable,
            entry_count: 0,
            time_to_first_entry_render_ms: None,
            provenance_key_stability: ProvenanceKeyStability::Unknown,
            canonical_safe_well_formedness: CanonicalSafeWellFormedness::Unknown,
        }
    }
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderRestoreAuditGateStatus {
    pub(crate) ready: bool,
    pub(crate) blocking_reasons: Vec<String>,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderRestoreAuditReport {
    pub(crate) cases: Vec<ProviderRestoreAuditCase>,
}

#[cfg(test)]
impl ProviderRestoreAuditReport {
    pub(crate) fn new(cases: Vec<ProviderRestoreAuditCase>) -> Self {
        Self { cases }
    }

    pub(crate) fn deletion_gate_status(
        &self,
        supported_provider_ids: &[&str],
    ) -> ProviderRestoreAuditGateStatus {
        let mut blocking_reasons = Vec::new();

        for provider_id in supported_provider_ids {
            let provider_cases = self
                .cases
                .iter()
                .filter(|case| case.provider_id == *provider_id);

            let has_non_empty_restore = provider_cases.clone().any(|case| {
                case.outcome == ProviderRestoreAuditOutcome::RestoredNonEmpty
                    && case.entry_count > 0
            });
            let has_missing_history = provider_cases
                .clone()
                .any(|case| case.outcome == ProviderRestoreAuditOutcome::MissingHistory);
            let has_unparseable_history = provider_cases
                .clone()
                .any(|case| case.outcome == ProviderRestoreAuditOutcome::UnparseableHistory);
            let has_stable_provenance = provider_cases
                .clone()
                .any(|case| case.provenance_key_stability == ProvenanceKeyStability::Stable);
            let has_any_well_formedness_verdict = provider_cases.clone().any(|case| {
                case.canonical_safe_well_formedness != CanonicalSafeWellFormedness::Unknown
            });
            let has_well_formed_canonical_keys = provider_cases.clone().any(|case| {
                case.canonical_safe_well_formedness == CanonicalSafeWellFormedness::WellFormed
            });

            if !has_non_empty_restore {
                blocking_reasons.push(format!(
                    "{provider_id} lacks a parseable non-empty restore case"
                ));
            }
            if !has_missing_history {
                blocking_reasons.push(format!(
                    "{provider_id} lacks a missing-history restore case"
                ));
            }
            if !has_unparseable_history {
                blocking_reasons.push(format!(
                    "{provider_id} lacks an unparseable-history restore case"
                ));
            }
            if !has_stable_provenance {
                blocking_reasons.push(format!(
                    "{provider_id} lacks a stable provenance-key verdict"
                ));
            }
            if !has_any_well_formedness_verdict {
                blocking_reasons.push(format!(
                    "{provider_id} lacks a canonical-safe well-formedness verdict"
                ));
            } else if !has_well_formed_canonical_keys {
                blocking_reasons.push(format!(
                    "{provider_id} failed the canonical-safe well-formedness check"
                ));
            }
        }

        ProviderRestoreAuditGateStatus {
            ready: blocking_reasons.is_empty(),
            blocking_reasons,
        }
    }

    pub(crate) fn p95_time_to_first_entry_render_ms(&self) -> Option<u128> {
        let mut samples: Vec<u128> = self
            .cases
            .iter()
            .filter_map(|case| case.time_to_first_entry_render_ms)
            .collect();

        if samples.is_empty() {
            return None;
        }

        samples.sort_unstable();
        let index = ((samples.len() * 95).saturating_add(99) / 100).saturating_sub(1);
        samples.get(index).copied()
    }

    pub(crate) fn max_allowed_time_to_first_entry_render_ms(&self) -> Option<u128> {
        self.p95_time_to_first_entry_render_ms()
            .map(|p95| p95.saturating_mul(125).saturating_add(99) / 100)
    }
}

fn session_open_error_from_provider_load(
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

fn history_replay_family(agent: &CanonicalAgentId) -> HistoryReplayFamily {
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

#[tauri::command]
#[specta::specta]
pub async fn get_session_open_result(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<SessionOpenResult, String> {
    let db = app.state::<DbConn>();
    let hub = app.state::<Arc<AcpEventHubState>>().inner().clone();
    let app_clone = app.clone();

    let context = crate::history::session_context::resolve_session_context(
        Some(db.inner()),
        &session_id,
        &project_path,
        &agent_id,
        source_path.as_deref(),
    )
    .await;
    let replay_context = context.replay_context();
    let thread_content =
        match load_provider_owned_session_snapshot(app_clone, &replay_context).await {
            Ok(snapshot) => snapshot,
            Err(error) => {
                match session_open_result_from_completed_local_journal(
                    db.inner(),
                    &hub,
                    &replay_context,
                    &session_id,
                    crate::acp::session_state_engine::selectors::SessionGraphLifecycle::detached(
                        crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
                    ),
                    crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty(),
                )
                .await
                {
                    Ok(Some(result)) => {
                        restore_session_open_authority(&app, &result);
                        return Ok(result);
                    }
                    Ok(None) => {}
                    Err(message) => {
                        return Ok(SessionOpenResult::Error(SessionOpenError::internal(
                            &session_id,
                            message,
                        )));
                    }
                }

                let open_error = session_open_error_from_provider_load(&session_id, error);
                // GOD: emit a Failed lifecycle envelope so canonical readers see the
                // failure through the canonical channel — no client-side synthesis.
                let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
                    session_id: session_id.clone(),
                    attempt_id: 0,
                    error: open_error.message.clone(),
                    // Provider snapshot load failure — not the same path as
                    // `session/load` rejection. Treat as transient/transport
                    // by default; classifier could be invoked here in future
                    // if `ProviderHistoryLoadError` gains richer cases.
                    failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
                };
                crate::acp::commands::emit_lifecycle_event(
                    &app,
                    &Some(hub.clone()),
                    update,
                    &session_id,
                )
                .await;
                return Ok(SessionOpenResult::Error(open_error));
            }
        };

    let Some(thread_content) = thread_content else {
        match session_open_result_from_completed_local_journal(
            db.inner(),
            &hub,
            &replay_context,
            &session_id,
            crate::acp::session_state_engine::selectors::SessionGraphLifecycle::detached(
                crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
            ),
            crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty(),
        )
        .await
        {
            Ok(Some(result)) => {
                restore_session_open_authority(&app, &result);
                return Ok(result);
            }
            Ok(None) => {}
            Err(message) => {
                return Ok(SessionOpenResult::Error(SessionOpenError::internal(
                    &session_id,
                    message,
                )));
            }
        }

        // GOD: emit a Failed lifecycle envelope so canonical readers see the
        // missing state through the canonical channel — no client-side synthesis.
        // History-not-available means the provider has no replayable state for
        // this session — same upstream-permanent semantics as session-not-found
        // at the resume boundary, so classify as SessionGoneUpstream.
        let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
            session_id: session_id.clone(),
            attempt_id: 0,
            error: "Provider history is not available for this session".to_string(),
            failure_reason: crate::acp::lifecycle::FailureReason::SessionGoneUpstream,
        };
        crate::acp::commands::emit_lifecycle_event(&app, &Some(hub.clone()), update, &session_id)
            .await;
        return Ok(SessionOpenResult::Missing(SessionOpenMissing {
            requested_session_id: session_id,
        }));
    };

    let runtime_registry = app
        .try_state::<Arc<crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry>>()
        .map(|state| state.inner().clone());

    let result =
        crate::acp::session_open_snapshot::session_open_result_from_provider_owned_snapshot(
            db.inner(),
            &hub,
            runtime_registry.as_deref(),
            &replay_context,
            &session_id,
            &thread_content,
        )
        .await;
    restore_session_open_authority(&app, &result);
    Ok(result)
}

fn restore_session_open_authority<R: tauri::Runtime>(
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
                .filter(|operation| {
                    crate::acp::projections::is_terminal_operation_state(&operation.operation_state)
                })
                .map(|operation| operation.tool_call_id.clone())
                .collect(),
            active_turn_failure: found.active_turn_failure.clone(),
            last_terminal_turn_id: found.last_terminal_turn_id.clone(),
            assistant_boundary_entry_count:
                assistant_boundary_entry_count_from_transcript_entries(
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

#[cfg(test)]
mod tests {
    use super::{
        apply_session_title_metadata, audit_restored_tool_links_from_snapshot,
        audit_session_load_timing_cli, history_replay_family,
        session_open_error_from_provider_load, CanonicalSafeWellFormedness, ProvenanceKeyStability,
        ProviderRestoreAuditCase, ProviderRestoreAuditReport,
    };
    use crate::acp::provider::{HistoryReplayFamily, ProviderHistoryLoadError};
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::session_open_snapshot::SessionOpenErrorReason;
    use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use crate::acp::types::CanonicalAgentId;
    use crate::db::repository::{
        SessionJournalEventRepository, SessionMetadataRepository, SessionMetadataRow,
    };
    use crate::session_jsonl::types::StoredEntry;
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory SQLite");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("Failed to run migrations");
        db
    }

    fn make_session(title: &str) -> SessionThreadSnapshot {
        SessionThreadSnapshot {
            entries: vec![],
            title: title.to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        }
    }

    fn make_tool_call_entry(id: &str, kind: ToolKind, status: ToolCallStatus) -> StoredEntry {
        StoredEntry::ToolCall {
            id: id.to_string(),
            message: ToolCallData {
                id: id.to_string(),
                name: kind.as_str().to_string(),
                arguments: ToolArguments::PlanMode {
                    mode: Some("plan".to_string()),
                    plan: None,
                    plan_file_path: None,
                    title: None,
                },
                diagnostic_input: None,
                status,
                result: None,
                kind: Some(kind),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            timestamp: None,
        }
    }

    #[test]
    fn restored_tool_link_audit_reports_projected_tool_rows() {
        let snapshot = SessionThreadSnapshot {
            entries: vec![make_tool_call_entry(
                "tool-1",
                ToolKind::Read,
                ToolCallStatus::Completed,
            )],
            title: "Audit me".to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        };

        let audit = audit_restored_tool_links_from_snapshot(
            "session-1",
            &CanonicalAgentId::ClaudeCode,
            &snapshot,
        );

        assert_eq!(audit.entry_count, 1);
        assert_eq!(audit.transcript_tool_count, 1);
        assert_eq!(audit.operation_count, 1);
        assert_eq!(audit.unresolved_count, 0);
    }

    #[test]
    fn restored_tool_link_audit_handles_large_restored_sessions() {
        let entries = (0..12_000)
            .map(|index| {
                make_tool_call_entry(
                    &format!("tool-{index}"),
                    ToolKind::Read,
                    ToolCallStatus::Completed,
                )
            })
            .collect();
        let snapshot = SessionThreadSnapshot {
            entries,
            title: "Large audit".to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        };

        let audit = audit_restored_tool_links_from_snapshot(
            "session-1",
            &CanonicalAgentId::ClaudeCode,
            &snapshot,
        );

        assert_eq!(audit.transcript_tool_count, 12_000);
        assert_eq!(audit.operation_count, 12_000);
        assert_eq!(audit.unresolved_count, 0);
    }

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
    fn title_override_wins_over_parsed_session_title() {
        let row = SessionMetadataRow {
            id: "session-1".to_string(),
            display: "Autonomous Mode".to_string(),
            title_overridden: true,
            timestamp: 0,
            project_path: "/repo".to_string(),
            agent_id: "claude-code".to_string(),
            file_path: "file.jsonl".to_string(),
            file_mtime: 0,
            file_size: 0,
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            is_acepe_managed: false,
            sequence_id: Some(1),
        };

        let converted =
            apply_session_title_metadata(make_session("Original Transcript Title"), Some(&row));

        assert_eq!(converted.title, "Autonomous Mode");
    }

    #[test]
    fn empty_snapshot_applies_title_override_metadata() {
        let row = SessionMetadataRow {
            id: "session-1".to_string(),
            display: "Autonomous Mode".to_string(),
            title_overridden: true,
            timestamp: 0,
            project_path: "/repo".to_string(),
            agent_id: "claude-code".to_string(),
            file_path: "file.jsonl".to_string(),
            file_mtime: 0,
            file_size: 0,
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            is_acepe_managed: false,
            sequence_id: Some(1),
        };

        let converted =
            apply_session_title_metadata(SessionThreadSnapshot::empty("session-1"), Some(&row));

        assert_eq!(converted.title, "Autonomous Mode");
    }

    #[test]
    fn derives_plan_mode_from_enter_plan_mode_entries() {
        let session = SessionThreadSnapshot {
            entries: vec![make_tool_call_entry(
                "tool-enter-plan-1",
                ToolKind::EnterPlanMode,
                ToolCallStatus::Completed,
            )],
            title: "Plan session".to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        };

        assert_eq!(
            super::derive_current_mode_id_from_entries(&session.entries),
            Some("plan".to_string())
        );
    }

    #[test]
    fn keeps_plan_mode_when_exit_plan_mode_is_not_completed() {
        let session = SessionThreadSnapshot {
            entries: vec![
                make_tool_call_entry(
                    "tool-enter-plan-1",
                    ToolKind::EnterPlanMode,
                    ToolCallStatus::Completed,
                ),
                make_tool_call_entry(
                    "tool-exit-plan-1",
                    ToolKind::ExitPlanMode,
                    ToolCallStatus::Pending,
                ),
            ],
            title: "Pending exit".to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        };

        assert_eq!(
            super::derive_current_mode_id_from_entries(&session.entries),
            Some("plan".to_string())
        );
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
    fn restore_audit_gate_requires_minimum_corpus_for_each_supported_provider() {
        let report = ProviderRestoreAuditReport::new(vec![
            ProviderRestoreAuditCase::happy_path("claude-code", "claude-session", 2, 120),
            ProviderRestoreAuditCase::missing_history("claude-code", "missing-claude"),
            ProviderRestoreAuditCase::unparseable_history("claude-code", "bad-claude"),
        ]);

        let gate = report.deletion_gate_status(&["claude-code", "copilot", "cursor"]);

        assert!(!gate.ready);
        assert!(gate
            .blocking_reasons
            .contains(&"copilot lacks a parseable non-empty restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"copilot lacks a missing-history restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"copilot lacks an unparseable-history restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks a parseable non-empty restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks a missing-history restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks an unparseable-history restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks a stable provenance-key verdict".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks a canonical-safe well-formedness verdict".to_string()));
    }

    #[test]
    fn restore_audit_gate_requires_stable_provenance_verdict() {
        let mut happy = ProviderRestoreAuditCase::happy_path("copilot", "copilot-session", 2, 80);
        happy.provenance_key_stability = ProvenanceKeyStability::Unstable;
        let report = ProviderRestoreAuditReport::new(vec![
            happy,
            ProviderRestoreAuditCase::missing_history("copilot", "missing-copilot"),
            ProviderRestoreAuditCase::unparseable_history("copilot", "bad-copilot"),
            ProviderRestoreAuditCase::provider_unavailable("copilot", "offline-copilot"),
        ]);

        let gate = report.deletion_gate_status(&["copilot"]);

        assert!(!gate.ready);
        assert_eq!(
            gate.blocking_reasons,
            vec!["copilot lacks a stable provenance-key verdict".to_string()]
        );
    }

    #[test]
    fn restore_audit_gate_requires_canonical_safe_well_formedness_verdict() {
        let mut cursor_happy =
            ProviderRestoreAuditCase::happy_path("cursor", "cursor-session", 2, 90);
        cursor_happy.canonical_safe_well_formedness = CanonicalSafeWellFormedness::NotWellFormed;
        let report = ProviderRestoreAuditReport::new(vec![
            cursor_happy,
            ProviderRestoreAuditCase::missing_history("cursor", "missing-cursor"),
            ProviderRestoreAuditCase::unparseable_history("cursor", "bad-cursor"),
            ProviderRestoreAuditCase::provider_unavailable("cursor", "offline-cursor"),
        ]);

        let gate = report.deletion_gate_status(&["cursor"]);

        assert!(!gate.ready);
        assert_eq!(
            gate.blocking_reasons,
            vec!["cursor failed the canonical-safe well-formedness check".to_string()]
        );
    }

    #[test]
    fn restore_audit_gate_accepts_cursor_when_stable_and_well_formed() {
        let report = ProviderRestoreAuditReport::new(vec![
            ProviderRestoreAuditCase::happy_path("cursor", "cursor-session", 2, 90),
            ProviderRestoreAuditCase::missing_history("cursor", "missing-cursor"),
            ProviderRestoreAuditCase::unparseable_history("cursor", "bad-cursor"),
            ProviderRestoreAuditCase::provider_unavailable("cursor", "offline-cursor"),
        ]);

        let gate = report.deletion_gate_status(&["cursor"]);

        assert!(gate.ready);
        assert!(gate.blocking_reasons.is_empty());
    }

    #[test]
    fn restore_audit_records_p95_and_regression_limit() {
        let report = ProviderRestoreAuditReport::new(vec![
            ProviderRestoreAuditCase::happy_path("copilot", "session-1", 1, 10),
            ProviderRestoreAuditCase::happy_path("copilot", "session-2", 1, 20),
            ProviderRestoreAuditCase::happy_path("copilot", "session-3", 1, 30),
            ProviderRestoreAuditCase::happy_path("copilot", "session-4", 1, 40),
            ProviderRestoreAuditCase::happy_path("copilot", "session-5", 1, 50),
        ]);

        assert_eq!(report.p95_time_to_first_entry_render_ms(), Some(50));
        assert_eq!(report.max_allowed_time_to_first_entry_render_ms(), Some(63));
    }

    #[tokio::test]
    async fn journal_has_no_events_before_materialization() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "canonical-session",
            "/repo",
            "copilot",
            None,
        )
        .await
        .expect("seed metadata");
        let replay_context = SessionReplayContext {
            local_session_id: "canonical-session".to_string(),
            history_session_id: "provider-canonical-session".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: crate::acp::parsers::AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        let revision =
            SessionJournalEventRepository::max_event_seq(&db, &replay_context.local_session_id)
                .await
                .expect("read revision");

        assert_eq!(revision, None);
    }

    #[tokio::test]
    #[ignore = "manual real-provider timing audit"]
    async fn manual_real_provider_timing_audit() {
        let session_id =
            std::env::var("ACEPE_AUDIT_SESSION_ID").expect("ACEPE_AUDIT_SESSION_ID is required");
        let project_path = std::env::var("ACEPE_AUDIT_PROJECT_PATH")
            .expect("ACEPE_AUDIT_PROJECT_PATH is required");
        let agent_id =
            std::env::var("ACEPE_AUDIT_AGENT_ID").expect("ACEPE_AUDIT_AGENT_ID is required");
        let source_path = std::env::var("ACEPE_AUDIT_SOURCE_PATH").ok();

        let timing = audit_session_load_timing_cli(session_id, project_path, agent_id, source_path)
            .await
            .expect("real-provider timing audit should run");

        assert!(
            timing.ok,
            "expected timing audit to find a restorable session"
        );
        assert!(
            timing.entry_count > 0,
            "expected timing audit to restore a non-empty session"
        );
        println!(
            "{}",
            serde_json::to_string(&timing).expect("serialize timing audit")
        );
    }
}

/// Audit session load timing for performance bottleneck identification.
///
/// CLI-only audit (no AppHandle). Supports Claude, Copilot, Cursor, Codex. Returns error for OpenCode.
pub async fn audit_session_load_timing_cli(
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<SessionLoadTiming, String> {
    let canonical_agent = CanonicalAgentId::parse(&agent_id);

    if matches!(canonical_agent, CanonicalAgentId::OpenCode) {
        return Err("OpenCode audit requires running app (use in-app invoke)".to_string());
    }
    if matches!(canonical_agent, CanonicalAgentId::Forge) {
        return Err("Forge audit is not implemented yet".to_string());
    }
    if matches!(canonical_agent, CanonicalAgentId::Custom(_)) {
        return Err("Custom agents do not support session load audit".to_string());
    }

    let mut stages = Vec::new();
    let total_start = Instant::now();

    let result = match canonical_agent {
        CanonicalAgentId::ClaudeCode => {
            let t0 = Instant::now();
            let session_path = session_jsonl_parser::find_session_file(&session_id, &project_path)
                .await
                .map_err(|e| format!("Failed to find Claude session file: {}", e))?;
            add_stage(&mut stages, "find_session_file", t0);

            let t1 = Instant::now();
            let full_session = session_jsonl_parser::parse_full_session_from_path(
                &session_id,
                &project_path,
                &session_path,
            )
            .await
            .map_err(|e| format!("Failed to parse Claude session: {}", e))?;
            add_stage(&mut stages, "read_and_parse", t1);

            let t2 = Instant::now();
            let snapshot = crate::session_converter::convert_claude_full_session_to_thread_snapshot(
                &full_session,
            );
            add_stage(&mut stages, "convert", t2);

            Some(snapshot)
        }
        CanonicalAgentId::Copilot => {
            let t0 = Instant::now();
            let snapshot = crate::copilot_history::load_thread_snapshot_from_disk(
                &session_id,
                source_path.as_deref(),
                &format!("Session {}", &session_id[..8.min(session_id.len())]),
            )
            .await
            .map_err(|e| format!("Failed to parse Copilot session: {}", e))?;
            add_stage(&mut stages, "load_session", t0);
            Some(snapshot)
        }
        CanonicalAgentId::Cursor => {
            if let Some(ref sp) = source_path {
                let t0 = Instant::now();
                match cursor_parser::load_session_from_source(&session_id, sp).await {
                    Ok(Some(fs)) => {
                        add_stage(&mut stages, "load_from_source", t0);
                        let t1 = Instant::now();
                        let snapshot =
                            crate::session_converter::convert_cursor_full_session_to_thread_snapshot(&fs);
                        add_stage(&mut stages, "convert", t1);
                        Some(snapshot)
                    }
                    Ok(None) | Err(_) => {
                        add_stage(&mut stages, "load_from_source_failed", t0);
                        let t_find = Instant::now();
                        let full_session = cursor_parser::find_session_by_id(&session_id)
                            .await
                            .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                        add_stage(&mut stages, "find_transcript", t_find);
                        match full_session {
                            Some(fs) => {
                                let t2 = Instant::now();
                                let s = crate::session_converter::convert_cursor_full_session_to_thread_snapshot(&fs);
                                add_stage(&mut stages, "convert", t2);
                                Some(s)
                            }
                            None => None,
                        }
                    }
                }
            } else {
                let t0 = Instant::now();
                let full_session = cursor_parser::find_session_by_id(&session_id)
                    .await
                    .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                add_stage(&mut stages, "find_transcript", t0);
                match full_session {
                    Some(fs) => {
                        let t1 = Instant::now();
                        let s =
                            crate::session_converter::convert_cursor_full_session_to_thread_snapshot(&fs);
                        add_stage(&mut stages, "convert", t1);
                        Some(s)
                    }
                    None => None,
                }
            }
        }
        CanonicalAgentId::Codex => {
            let t0 = Instant::now();
            let codex_result = codex_parser::load_thread_snapshot(
                &session_id,
                &project_path,
                source_path.as_deref(),
            )
            .await
            .map_err(|e| format!("Failed to parse Codex session: {}", e))?;
            add_stage(&mut stages, "load_session", t0);
            codex_result
        }
        CanonicalAgentId::OpenCode | CanonicalAgentId::Forge | CanonicalAgentId::Custom(_) => {
            unreachable!("handled above")
        }
    };

    let agent_name = match canonical_agent {
        CanonicalAgentId::ClaudeCode => "claude-code",
        CanonicalAgentId::Copilot => "copilot",
        CanonicalAgentId::Cursor => "cursor",
        CanonicalAgentId::Codex => "codex",
        CanonicalAgentId::OpenCode | CanonicalAgentId::Forge | CanonicalAgentId::Custom(_) => {
            unreachable!()
        }
    };

    let total_ms = total_start.elapsed().as_millis();
    let entry_count = result.as_ref().map(|s| s.entries.len()).unwrap_or(0);

    Ok(SessionLoadTiming {
        agent: agent_name.to_string(),
        total_ms,
        stages,
        entry_count,
        ok: result.is_some(),
    })
}

/// Returns per-stage durations (ms) for file discovery, parse, convert, etc.
/// Supports Claude and Cursor in CLI mode; OpenCode requires running app.
#[tauri::command]
#[specta::specta]
pub async fn audit_session_load_timing(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> CommandResult<SessionLoadTiming> {
    unexpected_command_result("audit_session_load_timing", "Failed to audit session load timing", async {

        let mut stages = Vec::new();
        let total_start = Instant::now();
        let canonical_agent = CanonicalAgentId::parse(&agent_id);

        if matches!(canonical_agent, CanonicalAgentId::Forge) {
            return Err("Forge audit is not implemented yet".to_string());
        }

        let (result, agent_name) = match canonical_agent {
            CanonicalAgentId::ClaudeCode => {
                let t0 = Instant::now();
                let session_path = session_jsonl_parser::find_session_file(&session_id, &project_path)
                    .await
                    .map_err(|e| format!("Failed to find Claude session file: {}", e))?;
                add_stage(&mut stages, "find_session_file", t0);

                let t1 = Instant::now();
                let full_session = session_jsonl_parser::parse_full_session_from_path(
                    &session_id,
                    &project_path,
                    &session_path,
                )
                .await
                .map_err(|e| format!("Failed to parse Claude session: {}", e))?;
                add_stage(&mut stages, "read_and_parse", t1);

                let t2 = Instant::now();
                let snapshot =
                    crate::session_converter::convert_claude_full_session_to_thread_snapshot(
                        &full_session,
                    );
                add_stage(&mut stages, "convert", t2);

                (Some(snapshot), "claude-code".to_string())
            }
            CanonicalAgentId::Copilot => {
                let t0 = Instant::now();
                let snapshot = crate::copilot_history::load_thread_snapshot_from_disk(
                    &session_id,
                    source_path.as_deref(),
                    &format!("Session {}", &session_id[..8.min(session_id.len())]),
                )
                .await
                .map_err(|e| format!("Failed to parse Copilot session: {}", e))?;
                add_stage(&mut stages, "load_session", t0);
                (Some(snapshot), "copilot".to_string())
            }
            CanonicalAgentId::Cursor => {
                if let Some(ref sp) = source_path {
                    let t0 = Instant::now();
                    match cursor_parser::load_session_from_source(&session_id, sp).await {
                        Ok(Some(fs)) => {
                            add_stage(&mut stages, "load_from_source", t0);
                            let t1 = Instant::now();
                            let snapshot =
                                crate::session_converter::convert_cursor_full_session_to_thread_snapshot(&fs);
                            add_stage(&mut stages, "convert", t1);
                            (Some(snapshot), "cursor".to_string())
                        }
                        Ok(None) | Err(_) => {
                            add_stage(&mut stages, "load_from_source_failed", t0);
                            let t_find = Instant::now();
                            let full_session = cursor_parser::find_session_by_id(&session_id)
                                .await
                                .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                            add_stage(&mut stages, "find_transcript", t_find);
                            let snapshot = match full_session {
                                Some(fs) => {
                                    let t2 = Instant::now();
                                    let s = crate::session_converter::convert_cursor_full_session_to_thread_snapshot(&fs);
                                    add_stage(&mut stages, "convert", t2);
                                    Some(s)
                                }
                                None => None,
                            };
                            (snapshot, "cursor".to_string())
                        }
                    }
                } else {
                    let t0 = Instant::now();
                    let full_session = cursor_parser::find_session_by_id(&session_id)
                        .await
                        .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                    add_stage(&mut stages, "find_transcript", t0);
                    let snapshot = match full_session {
                        Some(fs) => {
                            let t1 = Instant::now();
                            let s =
                                crate::session_converter::convert_cursor_full_session_to_thread_snapshot(&fs);
                            add_stage(&mut stages, "convert", t1);
                            Some(s)
                        }
                        None => None,
                    };
                    (snapshot, "cursor".to_string())
                }
            }
            CanonicalAgentId::OpenCode => {
                let t0 = Instant::now();
                let disk_result =
                    opencode_parser::load_session_from_disk(&session_id, source_path.as_deref()).await;
                add_stage(&mut stages, "load_from_disk", t0);

                if let Ok(Some(snapshot)) = disk_result {
                    (Some(snapshot), "opencode".to_string())
                } else {
                    let t1 = Instant::now();
                    match fetch_opencode_session(&app, &session_id, &project_path).await {
                        Ok(snapshot) => {
                            add_stage(&mut stages, "http_fetch", t1);
                            (Some(snapshot), "opencode".to_string())
                        }
                        Err(e) => {
                            add_stage(&mut stages, "http_failed", t1);
                            return Err(e);
                        }
                    }
                }
            }
            CanonicalAgentId::Codex => {
                let t0 = Instant::now();
                let codex_result =
                    codex_parser::load_thread_snapshot(&session_id, &project_path, source_path.as_deref())
                        .await
                        .map_err(|e| format!("Failed to parse Codex session: {}", e))?;
                add_stage(&mut stages, "load_session", t0);
                (codex_result, "codex".to_string())
            }
            CanonicalAgentId::Custom(_) => {
                return Err("Custom agents do not support session load audit".to_string());
            }
            CanonicalAgentId::Forge => unreachable!("handled above"),
        };

        let total_ms = total_start.elapsed().as_millis();
        let entry_count = result.as_ref().map(|c| c.entries.len()).unwrap_or(0);

        Ok(SessionLoadTiming {
            agent: agent_name,
            total_ms,
            stages,
            entry_count,
            ok: result.is_some(),
        })

    }.await)
}

/// Set the worktree path for a session in the metadata index.
/// Called by the frontend when a session is created within a worktree.
/// Accepts any existing git worktree path, not just Acepe-managed worktrees.
#[tauri::command]
#[specta::specta]
pub async fn set_session_worktree_path(
    app: AppHandle,
    session_id: String,
    worktree_path: String,
    project_path: Option<String>,
    agent_id: Option<String>,
) -> CommandResult<()> {
    unexpected_command_result(
        "set_session_worktree_path",
        "Failed to set session worktree path",
        async {
            tracing::info!(
                session_id = %session_id,
                worktree_path = %worktree_path,
                "Persisting worktree path for session"
            );

            let canonical = canonicalize_persisted_worktree_path(&worktree_path).map_err(|e| {
                tracing::error!(
                    session_id = %session_id,
                    worktree_path = %worktree_path,
                    error = %e,
                    "Worktree path validation failed"
                );
                format!("Invalid worktree path: {}", e)
            })?;

            let db = app
                .try_state::<DbConn>()
                .ok_or("Database not available")?
                .inner()
                .clone();

            SessionMetadataRepository::set_worktree_path(
                &db,
                &session_id,
                &canonical.to_string_lossy(),
                project_path.as_deref(),
                agent_id.as_deref(),
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    "Failed to persist worktree path to DB"
                );
                format!("Failed to set worktree path: {}", e)
            })?;

            if let (Some(_project_path), Some(_agent_id)) =
                (project_path.as_deref(), agent_id.as_deref())
            {
                SessionMetadataRepository::mark_as_acepe_managed(&db, &session_id)
                    .await
                    .map_err(|e| {
                        tracing::error!(
                            session_id = %session_id,
                            error = %e,
                            "Failed to promote session to Acepe-managed state"
                        );
                        format!("Failed to set worktree path: {}", e)
                    })?;
            }

            Ok(())
        }
        .await,
    )
}

/// Persist the PR number associated with a session.
/// Called by the frontend when a PR number is discovered in session entries.
#[tauri::command]
#[specta::specta]
pub async fn set_session_pr_number(
    app: AppHandle,
    session_id: String,
    pr_number: Option<i32>,
    pr_link_mode: Option<String>,
) -> CommandResult<()> {
    unexpected_command_result(
        "set_session_pr_number",
        "Failed to set session PR number",
        async {
            tracing::info!(
                session_id = %session_id,
                pr_number = ?pr_number,
                pr_link_mode = ?pr_link_mode,
                "Persisting PR number for session"
            );

            let db = app
                .try_state::<DbConn>()
                .ok_or("Database not available")?
                .inner()
                .clone();

            SessionMetadataRepository::set_pr_number(
                &db,
                &session_id,
                pr_number,
                pr_link_mode.as_deref(),
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    "Failed to persist PR number to DB"
                );
                format!("Failed to set PR number: {}", e)
            })
        }
        .await,
    )
}

/// Persist a user-provided title override for a session.
#[tauri::command]
#[specta::specta]
pub async fn set_session_title(
    app: AppHandle,
    session_id: String,
    title: String,
) -> CommandResult<()> {
    let trimmed_title = title.trim().to_string();
    if trimmed_title.is_empty() {
        return Err(SerializableCommandError::expected(
            "set_session_title",
            "Session title cannot be empty",
        ));
    }

    unexpected_command_result(
        "set_session_title",
        "Failed to set session title",
        async {
            tracing::info!(
                session_id = %session_id,
                "Persisting title override for session"
            );

            let db = app
                .try_state::<DbConn>()
                .ok_or("Database not available")?
                .inner()
                .clone();

            SessionMetadataRepository::set_title_override(
                &db,
                &session_id,
                Some(trimmed_title.as_str()),
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    "Failed to persist title override to DB"
                );
                format!("Failed to set session title: {}", e)
            })
        }
        .await,
    )
}
