use crate::acp::projections::OperationState;
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_update::ToolKind;
use crate::db::repository::SessionMetadataRow;

pub fn canonicalize_persisted_worktree_path(
    worktree_path: &str,
) -> Result<std::path::PathBuf, String> {
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
    title: String,
    metadata: Option<&SessionMetadataRow>,
) -> String {
    if let Some(row) = metadata {
        if row.title_overridden {
            return row.display.clone();
        }
    }

    title
}

pub fn derive_current_mode_id_from_graph(graph: &SessionStateGraph) -> Option<String> {
    let mut current_mode_id: Option<String> = None;

    for operation in &graph.operations {
        let Some(kind) = &operation.kind else {
            continue;
        };

        match kind {
            ToolKind::EnterPlanMode
                if matches!(
                    operation.operation_state,
                    OperationState::Pending
                        | OperationState::Running
                        | OperationState::Blocked
                        | OperationState::Completed
                ) =>
            {
                current_mode_id = Some("plan".to_string());
            }
            ToolKind::ExitPlanMode if operation.operation_state == OperationState::Completed => {
                current_mode_id = Some("build".to_string());
            }
            _ => {}
        }
    }

    current_mode_id
}

pub fn apply_derived_current_mode_metadata(
    current_mode_id: Option<String>,
    graph: &SessionStateGraph,
) -> Option<String> {
    current_mode_id.or_else(|| derive_current_mode_id_from_graph(graph))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_derived_current_mode_metadata, apply_session_title_metadata,
        derive_current_mode_id_from_graph,
    };
    use crate::acp::session::fold_export::fold_graph_from_history_events;
    use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
    use crate::acp::session_state_engine::graph::SessionStateGraph;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use crate::acp::types::CanonicalAgentId;
    use crate::db::repository::SessionMetadataRow;

    fn make_tool_call_event(
        provider_seq: u64,
        id: &str,
        kind: ToolKind,
        status: ToolCallStatus,
    ) -> ProviderEvent {
        ProviderEvent {
            source: CanonicalAgentId::ClaudeCode,
            provider_seq,
            provider_row_id: format!("row-{provider_seq}"),
            timestamp_ms: None,
            kind: ProviderEventKind::ToolCall(ToolCallData {
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
            }),
        }
    }

    fn fold_graph(events: &[ProviderEvent]) -> SessionStateGraph {
        fold_graph_from_history_events("session-1", &CanonicalAgentId::ClaudeCode, "/repo", events)
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
            apply_session_title_metadata("Original Transcript Title".to_string(), Some(&row));

        assert_eq!(converted, "Autonomous Mode");
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

        let converted = apply_session_title_metadata(String::new(), Some(&row));

        assert_eq!(converted, "Autonomous Mode");
    }

    #[test]
    fn parsed_title_is_kept_without_an_explicit_override() {
        assert_eq!(
            apply_session_title_metadata("Transcript title".to_string(), None),
            "Transcript title"
        );
    }

    #[test]
    fn derives_plan_mode_from_enter_plan_mode_entries() {
        let graph = fold_graph(&[make_tool_call_event(
            1,
            "tool-enter-plan-1",
            ToolKind::EnterPlanMode,
            ToolCallStatus::Completed,
        )]);

        assert_eq!(
            derive_current_mode_id_from_graph(&graph),
            Some("plan".to_string())
        );
    }

    #[test]
    fn keeps_plan_mode_when_exit_plan_mode_is_not_completed() {
        let graph = fold_graph(&[
            make_tool_call_event(
                1,
                "tool-enter-plan-1",
                ToolKind::EnterPlanMode,
                ToolCallStatus::Completed,
            ),
            make_tool_call_event(
                2,
                "tool-exit-plan-1",
                ToolKind::ExitPlanMode,
                ToolCallStatus::Pending,
            ),
        ]);

        assert_eq!(
            derive_current_mode_id_from_graph(&graph),
            Some("plan".to_string())
        );
    }

    #[test]
    fn completed_exit_returns_to_build_mode() {
        let graph = fold_graph(&[
            make_tool_call_event(
                1,
                "tool-enter-plan-1",
                ToolKind::EnterPlanMode,
                ToolCallStatus::Completed,
            ),
            make_tool_call_event(
                2,
                "tool-exit-plan-1",
                ToolKind::ExitPlanMode,
                ToolCallStatus::Completed,
            ),
        ]);

        assert_eq!(
            derive_current_mode_id_from_graph(&graph),
            Some("build".to_string())
        );
    }

    #[test]
    fn failed_enter_does_not_select_plan_mode() {
        let graph = fold_graph(&[make_tool_call_event(
            1,
            "tool-enter-plan-1",
            ToolKind::EnterPlanMode,
            ToolCallStatus::Failed,
        )]);

        assert_eq!(derive_current_mode_id_from_graph(&graph), None);
    }

    #[test]
    fn explicit_current_mode_metadata_wins_over_derived_history() {
        let graph = fold_graph(&[make_tool_call_event(
            1,
            "tool-enter-plan-1",
            ToolKind::EnterPlanMode,
            ToolCallStatus::Completed,
        )]);

        assert_eq!(
            apply_derived_current_mode_metadata(Some("build".to_string()), &graph),
            Some("build".to_string())
        );
    }
}
