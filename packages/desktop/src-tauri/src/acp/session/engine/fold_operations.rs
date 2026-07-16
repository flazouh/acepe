//! Tool-call operation fold — upsert operations linked to transcript tool entries.

use crate::acp::projections::helpers::{
    build_rejected_operation_id, derive_operation_state, enrich_read_arguments_from_filesystem,
    extract_operation_command, finalize_operation_snapshot,
    is_claude_resumed_missing_tool_result_update, is_terminal_operation_state,
    is_terminal_tool_call_status, merge_operation_snapshot_evidence,
    merge_update_arguments_with_existing, normalize_tool_call_for_operation_ingress,
    normalize_tool_call_update_for_operation_ingress, rejected_operation_snapshot,
    should_skip_unanswered_question_tool_operation,
};
use crate::acp::projections::{
    build_validated_canonical_operation_id, OperationDegradationCode, OperationDegradationReason,
    OperationSnapshot, OperationSourceLink, MAX_SESSION_OPERATIONS,
};
use crate::acp::session::engine::fold_interactions::{
    register_plan_approval_interaction, register_question_interaction,
};
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_update::{ToolCallData, ToolCallUpdateData};
use crate::acp::transcript_projection::{
    tool_call_id_from_authority_entry_id, TranscriptEntry, TranscriptEntryRole, TranscriptScope,
    TranscriptSegment,
};

/// Apply a tool-call create fact: transcript tool row + linked operation snapshot.
pub fn apply_tool_call(
    graph: &mut SessionStateGraph,
    event: &ProviderEvent,
    tool_call: &ToolCallData,
    scope: &TranscriptScope,
    turn_key: &str,
) {
    let tool_call = normalize_tool_call_for_operation_ingress(tool_call);
    if should_skip_unanswered_question_tool_operation(&tool_call) {
        return;
    }

    let session_id = graph.canonical_session_id.clone();
    let entry_id = resolve_tool_transcript_entry_id(graph, &tool_call.id, turn_key);

    append_tool_transcript_entry(graph, event, &entry_id, scope, &tool_call);

    let source_link = OperationSourceLink::transcript_linked(entry_id.clone());
    let operation = build_operation_from_tool_call(
        &session_id,
        graph.operations.len(),
        &tool_call,
        source_link,
    );
    upsert_operation(graph, operation);
    register_plan_approval_interaction(graph, &tool_call);
    register_question_interaction(graph, &tool_call, graph.revision.graph_revision);
}

/// Apply a tool-call update fact onto an existing linked operation.
pub fn apply_tool_call_update(graph: &mut SessionStateGraph, update: &ToolCallUpdateData) {
    let update = normalize_tool_call_update_for_operation_ingress(update);
    let Some(existing_index) = find_operation_index_by_tool_call(graph, &update.tool_call_id)
    else {
        return;
    };
    let existing = graph.operations[existing_index].clone();

    let next_status = if is_claude_resumed_missing_tool_result_update(&update) {
        crate::acp::session_update::ToolCallStatus::Completed
    } else {
        update
            .status
            .clone()
            .unwrap_or(existing.provider_status.clone())
    };
    let next_arguments =
        merge_update_arguments_with_existing(&existing.arguments, update.arguments.as_ref());
    let next_progressive_arguments =
        if let Some(streaming_arguments) = update.streaming_arguments.clone() {
            Some(streaming_arguments)
        } else if update.arguments.is_some()
            || update
                .status
                .as_ref()
                .is_some_and(is_terminal_tool_call_status)
        {
            None
        } else {
            existing.progressive_arguments.clone()
        };
    let next_title = update.title.clone().or(existing.title.clone());
    let next_result = update.result.clone().or(existing.result.clone());
    let next_normalized_todos = update
        .normalized_todos
        .clone()
        .or(existing.normalized_todos.clone());

    let derived_state = derive_operation_state(&next_status);
    let next_operation_state = if is_terminal_operation_state(&existing.operation_state) {
        existing.operation_state.clone()
    } else {
        derived_state
    };

    let updated_operation = OperationSnapshot {
        id: existing.id.clone(),
        session_id: existing.session_id.clone(),
        tool_call_id: existing.tool_call_id.clone(),
        name: existing.name.clone(),
        kind: existing.kind,
        provider_status: next_status,
        title: next_title.clone(),
        arguments: next_arguments.clone(),
        progressive_arguments: next_progressive_arguments.clone(),
        result: next_result,
        computer_payload: existing.computer_payload.clone(),
        command: extract_operation_command(
            Some(&next_arguments),
            next_progressive_arguments.as_ref(),
            next_title.as_deref(),
        ),
        normalized_todos: next_normalized_todos,
        parent_tool_call_id: existing.parent_tool_call_id.clone(),
        parent_operation_id: existing.parent_operation_id.clone(),
        child_tool_call_ids: existing.child_tool_call_ids.clone(),
        child_operation_ids: existing.child_operation_ids.clone(),
        operation_provenance_key: existing.operation_provenance_key.clone(),
        operation_state: next_operation_state,
        locations: existing.locations.clone(),
        skill_meta: existing.skill_meta.clone(),
        normalized_questions: existing.normalized_questions.clone(),
        question_answer: existing.question_answer.clone(),
        awaiting_plan_approval: existing.awaiting_plan_approval,
        plan_approval_request_id: existing.plan_approval_request_id,
        started_at_ms: existing.started_at_ms,
        completed_at_ms: existing.completed_at_ms,
        source_link: existing.source_link.clone(),
        degradation_reason: existing.degradation_reason.clone(),
    };

    let merged = merge_operation_snapshot_evidence(&existing, updated_operation);
    graph.operations[existing_index] = strip_fold_operation_timing(merged);
    graph.revision.graph_revision += 1;
}

fn resolve_tool_transcript_entry_id(
    graph: &SessionStateGraph,
    tool_call_id: &str,
    turn_key: &str,
) -> String {
    for entry in &graph.transcript_snapshot.entries {
        if entry.role != TranscriptEntryRole::Tool {
            continue;
        }
        let Some(existing_tool_call_id) = tool_call_id_from_authority_entry_id(&entry.entry_id)
        else {
            continue;
        };
        if existing_tool_call_id == tool_call_id {
            return entry.entry_id.clone();
        }
    }

    crate::acp::transcript_projection::derive_tool_entry_id(turn_key, tool_call_id)
}

fn append_tool_transcript_entry(
    graph: &mut SessionStateGraph,
    event: &ProviderEvent,
    entry_id: &str,
    scope: &TranscriptScope,
    tool_call: &ToolCallData,
) {
    let display_text = tool_call
        .title
        .clone()
        .unwrap_or_else(|| tool_call.name.clone());

    graph.transcript_snapshot.revision += 1;
    if let Some(index) = graph
        .transcript_snapshot
        .entries
        .iter()
        .position(|entry| entry.entry_id == entry_id)
    {
        graph.transcript_snapshot.entries[index] = TranscriptEntry {
            entry_id: entry_id.to_string(),
            scope: scope.clone(),
            role: TranscriptEntryRole::Tool,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:tool"),
                text: display_text,
            }],
            attempt_id: None,
            timestamp_ms: event.timestamp_ms,
        };
    } else {
        graph.transcript_snapshot.entries.push(TranscriptEntry {
            entry_id: entry_id.to_string(),
            scope: scope.clone(),
            role: TranscriptEntryRole::Tool,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:tool"),
                text: display_text,
            }],
            attempt_id: None,
            timestamp_ms: event.timestamp_ms,
        });
    }
    graph.revision.transcript_revision = graph.transcript_snapshot.revision;
}

fn build_operation_from_tool_call(
    session_id: &str,
    existing_operation_count: usize,
    tool_call: &ToolCallData,
    source_link: OperationSourceLink,
) -> OperationSnapshot {
    let operation_id = match build_validated_canonical_operation_id(session_id, &tool_call.id) {
        Ok(operation_id) => operation_id,
        Err(_) => {
            return rejected_operation_snapshot(
                build_rejected_operation_id(session_id, &tool_call.id),
                session_id,
                tool_call,
                None,
                None,
                OperationDegradationReason {
                    code: OperationDegradationCode::InvalidProvenanceKey,
                    detail: Some("Operation provenance key failed validation".to_string()),
                },
                source_link,
            );
        }
    };

    if existing_operation_count >= MAX_SESSION_OPERATIONS {
        return rejected_operation_snapshot(
            build_rejected_operation_id(session_id, &tool_call.id),
            session_id,
            tool_call,
            None,
            None,
            OperationDegradationReason {
                code: OperationDegradationCode::MissingEvidence,
                detail: Some(format!(
                    "Session operation limit of {MAX_SESSION_OPERATIONS} was reached"
                )),
            },
            source_link,
        );
    }

    let arguments = enrich_read_arguments_from_filesystem(tool_call.arguments.clone());
    let derived_operation_state = derive_operation_state(&tool_call.status);

    let operation = OperationSnapshot {
        id: operation_id,
        session_id: session_id.to_string(),
        tool_call_id: tool_call.id.clone(),
        name: tool_call.name.clone(),
        kind: tool_call.kind,
        provider_status: tool_call.status.clone(),
        title: tool_call.title.clone(),
        arguments: arguments.clone(),
        progressive_arguments: None,
        result: tool_call.result.clone(),
        computer_payload: None,
        command: extract_operation_command(Some(&arguments), None, tool_call.title.as_deref()),
        normalized_todos: tool_call.normalized_todos.clone(),
        parent_tool_call_id: None,
        parent_operation_id: None,
        child_tool_call_ids: Vec::new(),
        child_operation_ids: Vec::new(),
        operation_provenance_key: Some(tool_call.id.clone()),
        operation_state: derived_operation_state,
        locations: tool_call.locations.clone(),
        skill_meta: tool_call.skill_meta.clone(),
        normalized_questions: tool_call.normalized_questions.clone(),
        question_answer: tool_call.question_answer.clone(),
        awaiting_plan_approval: tool_call.awaiting_plan_approval,
        plan_approval_request_id: tool_call.plan_approval_request_id,
        started_at_ms: None,
        completed_at_ms: None,
        source_link,
        degradation_reason: None,
    };

    finalize_operation_snapshot(None, operation)
}

/// Historical fold matches materialization: no live lifecycle timestamps on operations.
fn strip_fold_operation_timing(mut operation: OperationSnapshot) -> OperationSnapshot {
    operation.started_at_ms = None;
    operation.completed_at_ms = None;
    operation
}

fn find_operation_index_by_tool_call(
    graph: &SessionStateGraph,
    tool_call_id: &str,
) -> Option<usize> {
    graph
        .operations
        .iter()
        .position(|operation| operation.tool_call_id == tool_call_id)
}

fn upsert_operation(graph: &mut SessionStateGraph, operation: OperationSnapshot) {
    if let Some(index) = graph
        .operations
        .iter()
        .position(|existing| existing.id == operation.id)
    {
        let existing = graph.operations[index].clone();
        graph.operations[index] =
            strip_fold_operation_timing(finalize_operation_snapshot(Some(&existing), operation));
    } else if let Some(index) = find_operation_index_by_tool_call(graph, &operation.tool_call_id) {
        let existing = graph.operations[index].clone();
        graph.operations[index] =
            strip_fold_operation_timing(finalize_operation_snapshot(Some(&existing), operation));
    } else {
        graph
            .operations
            .push(strip_fold_operation_timing(finalize_operation_snapshot(
                None, operation,
            )));
    }
    graph.revision.graph_revision += 1;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::AgentType;
    use crate::acp::projections::OperationSourceLink;
    use crate::acp::session::engine::fold::{fold_full, FoldContext};
    use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
    use crate::acp::session_update::parse_session_update_with_agent;
    use crate::acp::session_update::SessionUpdate;
    use crate::acp::transcript_projection::tool_call_id_from_authority_entry_id;
    use crate::acp::types::CanonicalAgentId;
    use serde_json::Value;

    fn fixture_provider_events() -> Vec<ProviderEvent> {
        const FIXTURE: &str =
            include_str!("../../reconciler/tests/fixtures/historical-tool-call-session.jsonl");

        FIXTURE
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .enumerate()
            .map(|(index, line)| {
                let value: Value = serde_json::from_str(line)
                    .unwrap_or_else(|error| panic!("invalid fixture JSON: {error}\n{line}"));
                let update = parse_session_update_with_agent::<serde_json::Error>(
                    &value,
                    AgentType::ClaudeCode,
                )
                .unwrap_or_else(|error| panic!("failed to parse fixture line: {error}\n{line}"));
                session_update_to_provider_event((index + 1) as u64, update)
            })
            .collect()
    }

    fn session_update_to_provider_event(seq: u64, update: SessionUpdate) -> ProviderEvent {
        match update {
            SessionUpdate::ToolCall { tool_call, .. } => ProviderEvent {
                source: CanonicalAgentId::ClaudeCode,
                provider_seq: seq,
                provider_row_id: format!("tool-{}", tool_call.id),
                timestamp_ms: None,
                kind: ProviderEventKind::ToolCall(tool_call),
            },
            SessionUpdate::ToolCallUpdate { update, .. } => ProviderEvent {
                source: CanonicalAgentId::ClaudeCode,
                provider_seq: seq,
                provider_row_id: format!("update-{}", update.tool_call_id),
                timestamp_ms: None,
                kind: ProviderEventKind::ToolCallUpdate(update),
            },
            other => panic!("unexpected fixture update: {other:?}"),
        }
    }

    #[test]
    fn fold_historical_tool_call_fixture_creates_linked_operations() {
        let events = fixture_provider_events();
        let ctx = FoldContext::new("sess-hist-001", CanonicalAgentId::ClaudeCode, "/tmp");
        let graph = fold_full(&events, &ctx);

        assert!(
            graph.operations.len() >= 1,
            "expected at least one operation, got {}",
            graph.operations.len()
        );

        let tool_entries: Vec<_> = graph
            .transcript_snapshot
            .entries
            .iter()
            .filter(|entry| entry.role == TranscriptEntryRole::Tool)
            .collect();
        assert!(!tool_entries.is_empty(), "expected tool transcript entries");

        for operation in &graph.operations {
            let OperationSourceLink::TranscriptLinked { entry_id } = &operation.source_link else {
                continue;
            };
            assert!(
                graph
                    .transcript_snapshot
                    .entries
                    .iter()
                    .any(|entry| entry.entry_id == *entry_id),
                "operation {} must link to transcript entry {}",
                operation.tool_call_id,
                entry_id
            );
            let linked_tool_call_id = tool_call_id_from_authority_entry_id(entry_id);
            assert_eq!(
                linked_tool_call_id.as_deref(),
                Some(operation.tool_call_id.as_str()),
                "transcript entry must encode tool call id"
            );
        }
    }
}
