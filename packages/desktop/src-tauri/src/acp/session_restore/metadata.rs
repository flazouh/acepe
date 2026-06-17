use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::db::repository::SessionMetadataRow;
use crate::session_jsonl::types::StoredEntry;

pub fn canonicalize_persisted_worktree_path(worktree_path: &str) -> Result<std::path::PathBuf, String> {
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

pub fn apply_session_title_metadata(
    mut session: SessionThreadSnapshot,
    metadata: Option<&SessionMetadataRow>,
) -> SessionThreadSnapshot {
    if let Some(row) = metadata {
        if row.title_overridden {
            session.title = row.display.clone();
        }
    }

    session
}

pub fn apply_provider_session_title_metadata(
    mut session: ProviderOwnedSessionSnapshot,
    metadata: Option<&SessionMetadataRow>,
) -> ProviderOwnedSessionSnapshot {
    session.thread_snapshot = apply_session_title_metadata(session.thread_snapshot, metadata);
    session
}

pub fn derive_current_mode_id_from_entries(entries: &[StoredEntry]) -> Option<String> {
    let mut current_mode_id: Option<String> = None;

    for entry in entries {
        let StoredEntry::ToolCall { message, .. } = entry else {
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

pub fn apply_derived_current_mode_metadata(mut session: SessionThreadSnapshot) -> SessionThreadSnapshot {
    if session.current_mode_id.is_none() {
        session.current_mode_id = derive_current_mode_id_from_entries(&session.entries);
    }

    session
}

pub fn apply_provider_derived_current_mode_metadata(
    mut session: ProviderOwnedSessionSnapshot,
) -> ProviderOwnedSessionSnapshot {
    session.thread_snapshot = apply_derived_current_mode_metadata(session.thread_snapshot);
    session
}

#[cfg(test)]
mod tests {
    use super::{apply_session_title_metadata, derive_current_mode_id_from_entries};
    use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
    use crate::acp::session_update::{ToolCallStatus, ToolKind};
    use crate::db::repository::SessionMetadataRow;

    fn make_session(title: &str) -> SessionThreadSnapshot {
        SessionThreadSnapshot {
            entries: vec![],
            title: title.to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        }
    }

    fn make_tool_call_entry(id: &str, kind: ToolKind, status: ToolCallStatus) -> crate::session_jsonl::types::StoredEntry {
        use crate::acp::session_update::{ToolArguments, ToolCallData};
        crate::session_jsonl::types::StoredEntry::ToolCall {
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
            derive_current_mode_id_from_entries(&session.entries),
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
            derive_current_mode_id_from_entries(&session.entries),
            Some("plan".to_string())
        );
    }
}
