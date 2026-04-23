use super::*;
use crate::acp::event_hub::AcpEventHubState;
use crate::acp::provider::HistoryReplayFamily;
use crate::acp::registry::AgentRegistry;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_open_snapshot::{SessionOpenError, SessionOpenMissing, SessionOpenResult};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::commands::observability::{
    unexpected_command_result, CommandResult, SerializableCommandError,
};
use crate::db::repository::SessionMetadataRepository;
use crate::opencode_history::commands::fetch_opencode_session;
use sea_orm::DbConn;
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

fn session_open_error_from_provider_load(
    requested_session_id: &str,
    message: String,
) -> SessionOpenError {
    if message.contains("provider history parse failed") {
        SessionOpenError::parse_failure(requested_session_id, message)
    } else {
        SessionOpenError::internal(requested_session_id, message)
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
) -> Result<Option<SessionThreadSnapshot>, String> {
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
            None => None,
        },
        HistoryReplayFamily::SharedCanonical => None,
    };

    Ok(result
        .map(apply_derived_current_mode_metadata)
        .map(|session| apply_session_title_metadata(session, context.session_metadata.as_ref())))
}

pub async fn load_provider_owned_session_snapshot(
    app: AppHandle,
    replay_context: &SessionReplayContext,
) -> Result<Option<SessionThreadSnapshot>, String> {
    let Some(db) = app.try_state::<DbConn>().map(|s| s.inner().clone()) else {
        return Err("Database unavailable for provider-owned session load".to_string());
    };
    let session_metadata =
        SessionMetadataRepository::get_by_id(&db, &replay_context.local_session_id)
            .await
            .map_err(|error| {
                format!(
                    "Failed to load session metadata for {}: {error}",
                    replay_context.local_session_id
                )
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
                return Ok(SessionOpenResult::Error(
                    session_open_error_from_provider_load(&session_id, error),
                ));
            }
        };

    let Some(thread_content) = thread_content else {
        return Ok(SessionOpenResult::Missing(SessionOpenMissing {
            requested_session_id: session_id,
        }));
    };

    Ok(
        crate::acp::session_open_snapshot::session_open_result_from_thread_snapshot(
            db.inner(),
            &hub,
            &replay_context,
            &session_id,
            &thread_content,
        )
        .await,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        apply_session_title_metadata, history_replay_family, session_open_error_from_provider_load,
    };
    use crate::acp::provider::HistoryReplayFamily;
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
                },
                raw_input: None,
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
            provider_session_id: None,
            worktree_path: None,
            pr_number: None,
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
            provider_session_id: None,
            worktree_path: None,
            pr_number: None,
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
    fn provider_history_parse_failures_are_non_retryable_parse_errors() {
        let error = session_open_error_from_provider_load(
            "session-1",
            "Claude provider history parse failed: invalid JSON".to_string(),
        );

        assert!(matches!(
            error.reason,
            SessionOpenErrorReason::ParseFailure
        ));
        assert!(!error.retryable);
    }

    #[test]
    fn provider_history_load_failures_remain_retryable_internal_errors() {
        let error = session_open_error_from_provider_load(
            "session-1",
            "Copilot provider history load failed: transport timeout".to_string(),
        );

        assert!(matches!(error.reason, SessionOpenErrorReason::Internal));
        assert!(error.retryable);
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
}

/// Audit session load timing for performance bottleneck identification.
///
/// CLI-only audit (no AppHandle). Supports Claude, Cursor, Codex. Returns error for OpenCode.
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
    if matches!(canonical_agent, CanonicalAgentId::Copilot) {
        return Err("Copilot audit is not implemented yet".to_string());
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
        CanonicalAgentId::OpenCode
        | CanonicalAgentId::Copilot
        | CanonicalAgentId::Forge
        | CanonicalAgentId::Custom(_) => {
            unreachable!("handled above")
        }
    };

    let agent_name = match canonical_agent {
        CanonicalAgentId::ClaudeCode => "claude-code",
        CanonicalAgentId::Cursor => "cursor",
        CanonicalAgentId::Codex => "codex",
        CanonicalAgentId::OpenCode
        | CanonicalAgentId::Copilot
        | CanonicalAgentId::Forge
        | CanonicalAgentId::Custom(_) => {
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

        if matches!(canonical_agent, CanonicalAgentId::Copilot) {
            return Err("Copilot audit is not implemented yet".to_string());
        }
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
            CanonicalAgentId::Copilot | CanonicalAgentId::Forge => unreachable!("handled above"),
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
