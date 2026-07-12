use std::collections::HashSet;

use crate::acp::projections::{OperationSnapshot, OperationSourceLink, ProjectionRegistry};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::transcript_projection::{
    TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;
use crate::codex_history::parser as codex_parser;
use crate::cursor_history::parser as cursor_parser;
use crate::opencode_history::parser as opencode_parser;
use crate::session_jsonl::parser as session_jsonl_parser;

use super::types::{RestoredToolLinkAudit, UnresolvedToolRowAudit};

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
        .map(|segment| segment.primary_text())
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
            Ok(Some(
                super::fold_audit::claude_thread_snapshot_from_jsonl_path(
                    session_id,
                    project_path,
                    std::path::PathBuf::from(session_path),
                )?,
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
                super::fold_audit::cursor_thread_snapshot_from_full_session(&full_session),
            ));
        }
    }

    let full_session = cursor_parser::find_session_by_id(session_id).await?;
    Ok(full_session
        .map(|session| super::fold_audit::cursor_thread_snapshot_from_full_session(&session)))
}

#[cfg(test)]
mod tests {
    use super::audit_restored_tool_links_from_snapshot;
    use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use crate::acp::types::CanonicalAgentId;
    use crate::session_jsonl::types::StoredEntry;

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
}
