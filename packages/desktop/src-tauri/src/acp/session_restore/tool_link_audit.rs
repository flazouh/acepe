use std::collections::HashSet;

use crate::acp::projections::{OperationSnapshot, OperationSourceLink};
use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session::fold_export::MaterializedThreadSnapshot;
use crate::acp::session::ingress::stored_entry_events::stored_entries_to_provider_events;
use crate::acp::transcript_projection::{
    TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::StoredEntry;

use super::fold_audit::materialized_from_history;
use super::types::{RestoredToolLinkAudit, UnresolvedToolRowAudit};

pub(crate) fn audit_restored_tool_links_from_materialized(
    session_id: &str,
    agent_id: &CanonicalAgentId,
    materialized: &MaterializedThreadSnapshot,
) -> RestoredToolLinkAudit {
    let transcript_snapshot = &materialized.transcript_snapshot;
    let operations = &materialized.projection.operations;
    let unresolved_rows = unresolved_tool_rows_for_operations(transcript_snapshot, operations);
    let transcript_tool_count = transcript_snapshot
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
        .count();

    RestoredToolLinkAudit {
        session_id: session_id.to_string(),
        agent_id: agent_id.to_string_with_prefix(),
        entry_count: transcript_snapshot.entries.len(),
        transcript_tool_count,
        operation_count: operations.len(),
        unresolved_count: unresolved_rows.len(),
        unresolved_rows,
    }
}

pub fn audit_restored_tool_links_from_stored_entries(
    session_id: &str,
    agent_id: &CanonicalAgentId,
    entries: &[StoredEntry],
) -> RestoredToolLinkAudit {
    let events = stored_entries_to_provider_events(entries, agent_id.clone());
    let graph = fold_full(&events, &FoldContext::new(session_id, agent_id.clone(), ""));
    let transcript_snapshot = &graph.transcript_snapshot;
    let unresolved_rows =
        unresolved_tool_rows_for_operations(transcript_snapshot, &graph.operations);
    let transcript_tool_count = transcript_snapshot
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
        .count();

    RestoredToolLinkAudit {
        session_id: session_id.to_string(),
        agent_id: agent_id.to_string_with_prefix(),
        entry_count: entries.len(),
        transcript_tool_count,
        operation_count: graph.operations.len(),
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
    let materialized =
        load_materialized_for_audit_cli(&session_id, &project_path, &canonical_agent, source_path)
            .await?;

    let Some(materialized) = materialized else {
        return Err(format!(
            "No restored session snapshot found for {session_id}"
        ));
    };

    Ok(audit_restored_tool_links_from_materialized(
        &session_id,
        &canonical_agent,
        &materialized,
    ))
}

async fn load_materialized_for_audit_cli(
    session_id: &str,
    project_path: &str,
    canonical_agent: &CanonicalAgentId,
    source_path: Option<String>,
) -> Result<Option<MaterializedThreadSnapshot>, String> {
    match canonical_agent {
        CanonicalAgentId::Forge => Err("Forge audit is not implemented yet".to_string()),
        CanonicalAgentId::Custom(_) => {
            Err("Custom agents do not support restored tool link audit".to_string())
        }
        _ => {
            materialized_from_history(
                canonical_agent,
                session_id,
                project_path,
                source_path.as_deref(),
            )
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::audit_restored_tool_links_from_stored_entries;
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
        let entries = vec![make_tool_call_entry(
            "tool-1",
            ToolKind::Read,
            ToolCallStatus::Completed,
        )];

        let audit = audit_restored_tool_links_from_stored_entries(
            "session-1",
            &CanonicalAgentId::ClaudeCode,
            &entries,
        );

        assert_eq!(audit.entry_count, 1);
        assert_eq!(audit.transcript_tool_count, 1);
        assert_eq!(audit.operation_count, 1);
        assert_eq!(audit.unresolved_count, 0);
    }

    #[test]
    fn restored_tool_link_audit_handles_large_restored_sessions() {
        let entries: Vec<StoredEntry> = (0..12_000)
            .map(|index| {
                make_tool_call_entry(
                    &format!("tool-{index}"),
                    ToolKind::Read,
                    ToolCallStatus::Completed,
                )
            })
            .collect();

        let audit = audit_restored_tool_links_from_stored_entries(
            "session-1",
            &CanonicalAgentId::ClaudeCode,
            &entries,
        );

        assert_eq!(audit.transcript_tool_count, 12_000);
        assert_eq!(audit.operation_count, 12_000);
        assert_eq!(audit.unresolved_count, 0);
    }
}
