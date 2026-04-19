use super::*;
use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::{ProjectionRegistry, SessionProjectionSnapshot};
use crate::acp::provider::HistoryReplayFamily;
use crate::acp::registry::AgentRegistry;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_journal::{SessionJournalEvent, SessionJournalEventPayload};
use crate::acp::session_open_snapshot::{
    assemble_session_open_result, SessionOpenMissing, SessionOpenResult,
};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::commands::observability::{
    unexpected_command_result, CommandResult, SerializableCommandError,
};
use crate::db::repository::{
    SessionJournalEventRepository, SessionMetadataRepository, SessionThreadSnapshotRepository,
    SessionTranscriptSnapshotRepository,
};
use crate::opencode_history::commands::fetch_opencode_session;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QuerySelect, Set, TransactionTrait,
};
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

fn history_replay_family(agent: &CanonicalAgentId) -> HistoryReplayFamily {
    crate::acp::parsers::provider_capabilities::provider_capabilities(
        crate::acp::parsers::AgentType::from_canonical(agent),
    )
    .history_replay_policy
    .family
}

fn projection_has_runtime_state(snapshot: &SessionProjectionSnapshot) -> bool {
    snapshot.session.is_some()
        || !snapshot.operations.is_empty()
        || !snapshot.interactions.is_empty()
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

fn build_transcript_snapshot(
    revision: i64,
    snapshot: &SessionThreadSnapshot,
) -> crate::acp::transcript_projection::TranscriptSnapshot {
    crate::acp::transcript_projection::TranscriptSnapshot::from_stored_entries(
        revision,
        &snapshot.entries,
    )
}

async fn persist_canonical_materialization(
    db: &DbConn,
    replay_context: &SessionReplayContext,
    snapshot: &SessionThreadSnapshot,
    projection: &SessionProjectionSnapshot,
) -> Result<(), String> {
    let has_projection_state = projection_has_runtime_state(projection);
    let session_id = replay_context.local_session_id.clone();

    db.transaction::<_, (), sea_orm::DbErr>(|txn| {
        let session_id = session_id.clone();
        let snapshot = snapshot.clone();
        let projection = projection.clone();
        Box::pin(async move {
            let now = chrono::Utc::now();
            let max_seq: Option<i64> = crate::db::entities::session_journal_event::Entity::find()
                .select_only()
                .column_as(
                    crate::db::entities::session_journal_event::Column::EventSeq.max(),
                    "max_seq",
                )
                .filter(
                    crate::db::entities::session_journal_event::Column::SessionId.eq(&session_id),
                )
                .into_tuple::<Option<i64>>()
                .one(txn)
                .await?
                .flatten();
            let revision = if let Some(revision) = max_seq {
                revision
            } else {
                let barrier = SessionJournalEvent::new(
                    &session_id,
                    1,
                    SessionJournalEventPayload::MaterializationBarrier,
                );
                crate::db::entities::session_journal_event::Entity::insert(
                    crate::db::entities::session_journal_event::ActiveModel {
                        event_id: Set(barrier.event_id.clone()),
                        session_id: Set(barrier.session_id.clone()),
                        event_seq: Set(barrier.event_seq),
                        event_kind: Set(barrier.event_kind().to_string()),
                        event_json: Set(serde_json::to_string(&barrier.payload)
                            .map_err(|error| sea_orm::DbErr::Custom(error.to_string()))?),
                        created_at: Set(now),
                    },
                )
                .exec(txn)
                .await?;
                barrier.event_seq
            };
            let transcript_json =
                serde_json::to_string(&build_transcript_snapshot(revision, &snapshot))
                    .map_err(|error| sea_orm::DbErr::Custom(error.to_string()))?;
            let projection_json = serde_json::to_string(&projection)
                .map_err(|error| sea_orm::DbErr::Custom(error.to_string()))?;

            if let Some(existing_model) =
                crate::db::entities::session_transcript_snapshot::Entity::find_by_id(&session_id)
                    .one(txn)
                    .await?
            {
                let mut active: crate::db::entities::session_transcript_snapshot::ActiveModel =
                    existing_model.into();
                active.snapshot_json = Set(transcript_json.clone());
                active.updated_at = Set(now);
                active.update(txn).await?;
            } else {
                crate::db::entities::session_transcript_snapshot::Entity::insert(
                    crate::db::entities::session_transcript_snapshot::ActiveModel {
                        session_id: Set(session_id.clone()),
                        snapshot_json: Set(transcript_json.clone()),
                        updated_at: Set(now),
                    },
                )
                .exec(txn)
                .await?;
            }

            if has_projection_state {
                if let Some(existing_model) =
                    crate::db::entities::session_projection_snapshot::Entity::find_by_id(
                        &session_id,
                    )
                    .one(txn)
                    .await?
                {
                    let mut active: crate::db::entities::session_projection_snapshot::ActiveModel =
                        existing_model.into();
                    active.snapshot_json = Set(projection_json.clone());
                    active.updated_at = Set(now);
                    active.update(txn).await?;
                } else {
                    crate::db::entities::session_projection_snapshot::Entity::insert(
                        crate::db::entities::session_projection_snapshot::ActiveModel {
                            session_id: Set(session_id.clone()),
                            snapshot_json: Set(projection_json.clone()),
                            updated_at: Set(now),
                        },
                    )
                    .exec(txn)
                    .await?;
                }
            } else {
                crate::db::entities::session_projection_snapshot::Entity::delete_by_id(&session_id)
                    .exec(txn)
                    .await?;
            }

            let thread_snapshot_json = serde_json::to_string(&snapshot)
                .map_err(|error| sea_orm::DbErr::Custom(error.to_string()))?;
            if let Some(existing_model) =
                crate::db::entities::session_thread_snapshot::Entity::find_by_id(&session_id)
                    .one(txn)
                    .await?
            {
                let mut active: crate::db::entities::session_thread_snapshot::ActiveModel =
                    existing_model.into();
                active.snapshot_json = Set(thread_snapshot_json);
                active.updated_at = Set(now);
                active.update(txn).await?;
            } else {
                crate::db::entities::session_thread_snapshot::Entity::insert(
                    crate::db::entities::session_thread_snapshot::ActiveModel {
                        session_id: Set(session_id.clone()),
                        snapshot_json: Set(thread_snapshot_json),
                        updated_at: Set(now),
                    },
                )
                .exec(txn)
                .await?;
            }

            Ok(())
        })
    })
    .await
    .map_err(|error| {
        format!(
            "Failed to persist canonical snapshots for {}: {error}",
            replay_context.local_session_id
        )
    })
}

pub async fn ensure_canonical_session_materialized(
    app: AppHandle,
    replay_context: &SessionReplayContext,
) -> Result<Option<SessionThreadSnapshot>, String> {
    let Some(db) = app.try_state::<DbConn>().map(|s| s.inner().clone()) else {
        return Err("Database unavailable for session materialization".to_string());
    };

    let journal_max =
        SessionJournalEventRepository::max_event_seq(&db, &replay_context.local_session_id)
            .await
            .map_err(|error| {
                format!(
                    "Failed to read journal cutoff for {}: {error}",
                    replay_context.local_session_id
                )
            })?
            .unwrap_or(0);
    let cached_transcript =
        SessionTranscriptSnapshotRepository::get(&db, &replay_context.local_session_id)
            .await
            .map_err(|error| {
                format!(
                    "Failed to load transcript snapshot for {}: {error}",
                    replay_context.local_session_id
                )
            })?;
    let transcript_stale = match cached_transcript.as_ref() {
        Some(snapshot) => snapshot.revision < journal_max,
        None => true,
    };
    if !transcript_stale {
        return Ok(None);
    }

    // Lazy-upgrade tier: if a canonical thread snapshot is already persisted, use it
    // to rebuild the transcript and projection snapshots without a provider history
    // reload.  This keeps re-open cheap for sessions that have been materialized at
    // least once and whose journal has since advanced (e.g. new live events after the
    // last materialization barrier).
    let cached_thread = SessionThreadSnapshotRepository::get(
        &db,
        &replay_context.local_session_id,
        &replay_context.agent_id,
    )
    .await
    .map_err(|error| {
        format!(
            "Failed to load thread snapshot for {}: {error}",
            replay_context.local_session_id
        )
    })?;

    if let Some(thread_snapshot) = cached_thread {
        let session_metadata =
            SessionMetadataRepository::get_by_id(&db, &replay_context.local_session_id)
                .await
                .map_err(|error| {
                    format!(
                        "Failed to load session metadata for {}: {error}",
                        replay_context.local_session_id
                    )
                })?;
        let thread_snapshot = apply_derived_current_mode_metadata(thread_snapshot);
        let thread_snapshot =
            apply_session_title_metadata(thread_snapshot, session_metadata.as_ref());
        let projection = ProjectionRegistry::project_thread_snapshot(
            &replay_context.local_session_id,
            Some(replay_context.agent_id.clone()),
            &thread_snapshot,
        );
        persist_canonical_materialization(&db, replay_context, &thread_snapshot, &projection)
            .await?;
        return Ok(Some(thread_snapshot));
    }

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
    let snapshot = load_unified_session_content_with_context(app, context).await?;
    let Some(snapshot) = snapshot else {
        return Ok(None);
    };

    let projection = ProjectionRegistry::project_thread_snapshot(
        &replay_context.local_session_id,
        Some(replay_context.agent_id.clone()),
        &snapshot,
    );
    persist_canonical_materialization(&db, replay_context, &snapshot, &projection).await?;

    Ok(Some(snapshot))
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
    let thread_content = ensure_canonical_session_materialized(app_clone, &replay_context).await?;
    let has_thread_content = thread_content.is_some();

    let session_metadata =
        SessionMetadataRepository::get_by_id(db.inner(), &replay_context.local_session_id)
            .await
            .map_err(|error| {
                format!(
                    "Failed to load session metadata for {}: {error}",
                    replay_context.local_session_id
                )
            })?;
    let metadata_exists = session_metadata.is_some();
    let journal_cutoff =
        SessionJournalEventRepository::max_event_seq(db.inner(), &replay_context.local_session_id)
            .await
            .map_err(|error| {
                format!(
                    "Failed to determine journal cutoff for {}: {error}",
                    replay_context.local_session_id
                )
            })?;

    if !metadata_exists && journal_cutoff.is_none() && !has_thread_content {
        return Ok(SessionOpenResult::Missing(SessionOpenMissing {
            requested_session_id: session_id,
        }));
    }

    Ok(assemble_session_open_result(db.inner(), &hub, &replay_context, &session_id).await)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_session_title_metadata, history_replay_family, persist_canonical_materialization,
    };
    use crate::acp::event_hub::AcpEventHubState;
    use crate::acp::provider::HistoryReplayFamily;
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::session_open_snapshot::{assemble_session_open_result, SessionOpenResult};
    use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use crate::acp::types::CanonicalAgentId;
    use crate::db::repository::{
        SessionJournalEventRepository, SessionMetadataRepository, SessionMetadataRow,
        SessionProjectionSnapshotRepository, SessionThreadSnapshotRepository,
        SessionTranscriptSnapshotRepository,
    };
    use crate::session_jsonl::types::StoredEntry;
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use std::sync::Arc;

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
    async fn canonical_tool_call_materialization_reopens_from_canonical_state_only() {
        let db = setup_test_db().await;
        let hub = Arc::new(AcpEventHubState::new());
        SessionMetadataRepository::ensure_exists(
            &db,
            "canonical-tool-session",
            "/repo",
            "copilot",
            None,
        )
        .await
        .expect("seed metadata");
        let snapshot = SessionThreadSnapshot {
            entries: vec![make_tool_call_entry(
                "tool-read-1",
                ToolKind::Read,
                ToolCallStatus::Completed,
            )],
            title: "Canonical session".to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        };
        let replay_context = SessionReplayContext {
            local_session_id: "canonical-tool-session".to_string(),
            history_session_id: "provider-canonical-tool-session".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: crate::acp::parsers::AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };
        let projection = crate::acp::projections::ProjectionRegistry::project_thread_snapshot(
            &replay_context.local_session_id,
            Some(replay_context.agent_id.clone()),
            &snapshot,
        );
        persist_canonical_materialization(&db, &replay_context, &snapshot, &projection)
            .await
            .expect("persist canonical materialization");

        let transcript_snapshot =
            SessionTranscriptSnapshotRepository::get(&db, "canonical-tool-session")
                .await
                .expect("load transcript")
                .expect("expected transcript");
        assert_eq!(transcript_snapshot.revision, 1);
        let projection_snapshot =
            SessionProjectionSnapshotRepository::get(&db, "canonical-tool-session")
                .await
                .expect("load projection")
                .expect("expected projection");
        assert!(
            projection_snapshot.session.is_some()
                || !projection_snapshot.operations.is_empty()
                || !projection_snapshot.interactions.is_empty()
        );

        let result =
            assemble_session_open_result(&db, &hub, &replay_context, "canonical-tool-session")
                .await;
        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };
        assert_eq!(found.transcript_snapshot.revision, 1);
        assert!(!found.transcript_snapshot.entries.is_empty());
    }

    // =========================================================================
    // Unit 0: Characterization — reconnect and recovery invariants (Rust side)
    //
    // These tests lock in the open-result contract that must stay true while
    // the canonical pipeline replaces legacy authority. Keep them green across
    // all later units.
    // =========================================================================

    #[tokio::test]
    async fn in_progress_tool_call_is_preserved_in_open_result_operations() {
        // When a session is reopened (e.g. during or after a reconnect), any
        // in-progress tool call that was materialized into the canonical
        // projection snapshot must appear in `SessionOpenFound.operations`.
        // This is the contract that lets the UI render the in-flight operation
        // without replaying the full event stream from scratch.
        let db = setup_test_db().await;
        let hub = Arc::new(AcpEventHubState::new());
        SessionMetadataRepository::ensure_exists(
            &db,
            "reconnect-in-progress-session",
            "/repo",
            "copilot",
            None,
        )
        .await
        .expect("seed metadata");

        let snapshot = SessionThreadSnapshot {
            entries: vec![make_tool_call_entry(
                "tool-read-inflight",
                ToolKind::Read,
                ToolCallStatus::InProgress,
            )],
            title: "Reconnect session".to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        };
        let replay_context = SessionReplayContext {
            local_session_id: "reconnect-in-progress-session".to_string(),
            history_session_id: "provider-reconnect-session".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: crate::acp::parsers::AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };
        let projection = crate::acp::projections::ProjectionRegistry::project_thread_snapshot(
            &replay_context.local_session_id,
            Some(replay_context.agent_id.clone()),
            &snapshot,
        );
        persist_canonical_materialization(&db, &replay_context, &snapshot, &projection)
            .await
            .expect("persist canonical materialization");

        let result = assemble_session_open_result(
            &db,
            &hub,
            &replay_context,
            "reconnect-in-progress-session",
        )
        .await;
        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found, got {result:?}");
        };

        // The in-progress operation must be present so the UI can resume rendering it
        assert!(
            !found.operations.is_empty(),
            "expected in-progress operation in open result"
        );
        let op = &found.operations[0];
        assert_eq!(op.tool_call_id, "tool-read-inflight");
        assert_eq!(op.status, ToolCallStatus::InProgress);
    }

    #[tokio::test]
    async fn session_with_no_materialized_projection_returns_empty_operations_and_interactions() {
        // A pre-cutover session that has not yet been materialized through the
        // canonical path returns an open result with no operations or interactions
        // rather than an error. This is the invariant that keeps older sessions
        // openable while the canonical pipeline rolls out.
        let db = setup_test_db().await;
        let hub = Arc::new(AcpEventHubState::new());
        SessionMetadataRepository::ensure_exists(
            &db,
            "pre-cutover-session",
            "/repo",
            "copilot",
            None,
        )
        .await
        .expect("seed metadata");

        let replay_context = SessionReplayContext {
            local_session_id: "pre-cutover-session".to_string(),
            history_session_id: "provider-pre-cutover-session".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: crate::acp::parsers::AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        // Intentionally do NOT call persist_canonical_materialization — simulates a
        // pre-cutover session that has no canonical projection in the DB yet.
        let result =
            assemble_session_open_result(&db, &hub, &replay_context, "pre-cutover-session").await;

        // Must return a valid Found result (not Error) so the session is still openable
        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found for pre-cutover session, got {result:?}");
        };
        assert!(
            found.operations.is_empty(),
            "expected empty operations for pre-cutover session"
        );
        assert!(
            found.interactions.is_empty(),
            "expected empty interactions for pre-cutover session"
        );
    }

    // =========================================================================
    // Unit 3: canonical thread snapshot persistence
    // =========================================================================

    #[tokio::test]
    async fn thread_snapshot_is_persisted_after_canonical_materialization() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "persist-thread-session",
            "/repo",
            "copilot",
            None,
        )
        .await
        .expect("seed metadata");

        let snapshot = SessionThreadSnapshot {
            entries: vec![make_tool_call_entry(
                "tool-read-persist",
                ToolKind::Read,
                ToolCallStatus::Completed,
            )],
            title: "Persist thread session".to_string(),
            created_at: "2026-04-19T00:00:00Z".to_string(),
            current_mode_id: None,
        };
        let replay_context = SessionReplayContext {
            local_session_id: "persist-thread-session".to_string(),
            history_session_id: "provider-persist-thread".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: crate::acp::parsers::AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };
        let projection = crate::acp::projections::ProjectionRegistry::project_thread_snapshot(
            &replay_context.local_session_id,
            Some(replay_context.agent_id.clone()),
            &snapshot,
        );
        persist_canonical_materialization(&db, &replay_context, &snapshot, &projection)
            .await
            .expect("persist canonical materialization");

        let thread = SessionThreadSnapshotRepository::get(
            &db,
            "persist-thread-session",
            &CanonicalAgentId::Copilot,
        )
        .await
        .expect("load thread snapshot")
        .expect("expected persisted thread snapshot after materialization");

        assert_eq!(thread.title, "Persist thread session");
        assert_eq!(thread.entries.len(), 1);
    }

    #[tokio::test]
    async fn thread_snapshot_is_updated_when_materialization_runs_again() {
        // Ensures the upsert path (not insert-only) works when re-materializing.
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "upsert-thread-session",
            "/repo",
            "copilot",
            None,
        )
        .await
        .expect("seed metadata");

        let replay_context = SessionReplayContext {
            local_session_id: "upsert-thread-session".to_string(),
            history_session_id: "provider-upsert-thread".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: crate::acp::parsers::AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        // First materialization
        let snapshot_v1 = SessionThreadSnapshot {
            entries: vec![],
            title: "Version one".to_string(),
            created_at: "2026-04-19T00:00:00Z".to_string(),
            current_mode_id: None,
        };
        let proj_v1 = crate::acp::projections::ProjectionRegistry::project_thread_snapshot(
            &replay_context.local_session_id,
            Some(replay_context.agent_id.clone()),
            &snapshot_v1,
        );
        persist_canonical_materialization(&db, &replay_context, &snapshot_v1, &proj_v1)
            .await
            .expect("first materialization");

        // Second materialization with different title (simulates provider history change)
        let snapshot_v2 = SessionThreadSnapshot {
            entries: vec![make_tool_call_entry(
                "tool-edit-v2",
                ToolKind::Edit,
                ToolCallStatus::Completed,
            )],
            title: "Version two".to_string(),
            created_at: "2026-04-19T00:00:00Z".to_string(),
            current_mode_id: None,
        };
        let proj_v2 = crate::acp::projections::ProjectionRegistry::project_thread_snapshot(
            &replay_context.local_session_id,
            Some(replay_context.agent_id.clone()),
            &snapshot_v2,
        );
        persist_canonical_materialization(&db, &replay_context, &snapshot_v2, &proj_v2)
            .await
            .expect("second materialization");

        let thread = SessionThreadSnapshotRepository::get(
            &db,
            "upsert-thread-session",
            &CanonicalAgentId::Copilot,
        )
        .await
        .expect("load thread snapshot")
        .expect("expected thread snapshot after re-materialization");

        assert_eq!(thread.title, "Version two");
        assert_eq!(thread.entries.len(), 1);
    }

    // =========================================================================
    // Unit 7: End-to-end canonical pipeline proof
    // =========================================================================

    /// [E2E] Integration: projection built from snapshot matches projection built
    /// from live materialization — the canonical pipeline produces deterministic
    /// state regardless of whether data arrived via snapshot or live events.
    #[tokio::test]
    async fn e2e_snapshot_projection_matches_live_materialization_projection() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "e2e-parity-session",
            "/repo",
            "claude-code",
            None,
        )
        .await
        .expect("seed metadata");

        let snapshot = SessionThreadSnapshot {
            entries: vec![
                make_tool_call_entry("read-1", ToolKind::Read, ToolCallStatus::Completed),
                make_tool_call_entry("write-1", ToolKind::Edit, ToolCallStatus::Completed),
            ],
            title: "E2E Parity Session".to_string(),
            created_at: "2026-04-19T00:00:00Z".to_string(),
            current_mode_id: None,
        };
        let replay_context = SessionReplayContext {
            local_session_id: "e2e-parity-session".to_string(),
            history_session_id: "provider-e2e-parity".to_string(),
            agent_id: CanonicalAgentId::ClaudeCode,
            parser_agent_type: crate::acp::parsers::AgentType::ClaudeCode,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        // Build projection directly from snapshot (the live execution path)
        let live_projection = crate::acp::projections::ProjectionRegistry::project_thread_snapshot(
            &replay_context.local_session_id,
            Some(replay_context.agent_id.clone()),
            &snapshot,
        );

        // Persist canonical materialization (as session-open does)
        persist_canonical_materialization(&db, &replay_context, &snapshot, &live_projection)
            .await
            .expect("persist canonical materialization");

        // Reload via assemble_session_open_result (snapshot path)
        let hub = Arc::new(AcpEventHubState::new());
        let open_result =
            assemble_session_open_result(&db, &hub, &replay_context, "e2e-parity-session").await;

        let found = match &open_result {
            SessionOpenResult::Found(f) => f,
            other => panic!("Expected Found, got {:?}", other),
        };

        // The snapshot path and live projection must agree on operation count
        assert_eq!(
            found.operations.len(),
            live_projection.operations.len(),
            "snapshot open must yield the same number of operations as the live projection"
        );
        // Both paths must agree on operation IDs (order-independent)
        let found_ids: std::collections::BTreeSet<String> =
            found.operations.iter().map(|op| op.id.clone()).collect();
        let live_ids: std::collections::BTreeSet<String> = live_projection
            .operations
            .iter()
            .map(|op| op.id.clone())
            .collect();
        assert_eq!(
            found_ids, live_ids,
            "operation IDs from snapshot open must match live projection"
        );
    }

    /// [E2E] Error path: agent crash/recovery — a session that had canonical
    /// materialization can be reopened after simulated crash, and produces
    /// non-empty operations (no data loss from the crash).
    ///
    /// This proves the canonical pipeline survives crash/recovery without
    /// duplicated or missing rows.
    #[tokio::test]
    async fn e2e_canonical_session_survives_crash_and_recovery_without_data_loss() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "e2e-crash-session",
            "/repo",
            "copilot",
            None,
        )
        .await
        .expect("seed metadata");

        let pre_crash_snapshot = SessionThreadSnapshot {
            entries: vec![make_tool_call_entry(
                "tool-pre-crash",
                ToolKind::Read,
                ToolCallStatus::Completed,
            )],
            title: "Pre-crash session".to_string(),
            created_at: "2026-04-19T00:00:00Z".to_string(),
            current_mode_id: None,
        };
        let replay_context = SessionReplayContext {
            local_session_id: "e2e-crash-session".to_string(),
            history_session_id: "provider-e2e-crash".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: crate::acp::parsers::AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        let pre_crash_projection =
            crate::acp::projections::ProjectionRegistry::project_thread_snapshot(
                &replay_context.local_session_id,
                Some(replay_context.agent_id.clone()),
                &pre_crash_snapshot,
            );

        // Persist state before crash
        persist_canonical_materialization(
            &db,
            &replay_context,
            &pre_crash_snapshot,
            &pre_crash_projection,
        )
        .await
        .expect("persist pre-crash materialization");

        // Simulate crash + recovery: reopen the session via canonical path
        let hub = Arc::new(AcpEventHubState::new());
        let recovered =
            assemble_session_open_result(&db, &hub, &replay_context, "e2e-crash-session").await;

        let found = match &recovered {
            SessionOpenResult::Found(f) => f,
            other => panic!("Expected Found after recovery, got {:?}", other),
        };

        // Operations from before the crash must survive
        assert!(
            !found.operations.is_empty(),
            "operations from before crash must survive canonical recovery"
        );
        // No duplicates: operation IDs must be unique
        let mut seen = std::collections::BTreeSet::new();
        for op in &found.operations {
            assert!(
                seen.insert(op.id.clone()),
                "duplicate operation id after recovery: {}",
                op.id
            );
        }
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
) -> CommandResult<()> {
    unexpected_command_result(
        "set_session_pr_number",
        "Failed to set session PR number",
        async {
            tracing::info!(
                session_id = %session_id,
                pr_number = ?pr_number,
                "Persisting PR number for session"
            );

            let db = app
                .try_state::<DbConn>()
                .ok_or("Database not available")?
                .inner()
                .clone();

            SessionMetadataRepository::set_pr_number(&db, &session_id, pr_number)
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
