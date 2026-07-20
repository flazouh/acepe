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
    tool_call_id_from_authority_entry_id, turn_key_for_assistant_boundary, TranscriptEntry,
    TranscriptEntryRole, TranscriptScope, TranscriptSegment,
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
    let parent_link = parent_link_from_tool_call_parent(graph, &tool_call);
    let _ = apply_tool_call_with_children(
        graph,
        event,
        &tool_call,
        scope,
        turn_key,
        parent_link.parent_operation_id,
        parent_link.parent_tool_call_id,
    );
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
    parent_operation_id: Option<String>,
    parent_tool_call_id: Option<String>,
    source_link: OperationSourceLink,
) -> OperationSnapshot {
    let operation_id = match build_validated_canonical_operation_id(session_id, &tool_call.id) {
        Ok(operation_id) => operation_id,
        Err(_) => {
            return rejected_operation_snapshot(
                build_rejected_operation_id(session_id, &tool_call.id),
                session_id,
                tool_call,
                parent_operation_id,
                parent_tool_call_id,
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
            parent_operation_id,
            parent_tool_call_id,
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
        parent_tool_call_id,
        parent_operation_id,
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

#[derive(Debug, Clone, Default)]
struct ParentOperationLink {
    parent_operation_id: Option<String>,
    parent_tool_call_id: Option<String>,
}

fn apply_tool_call_with_children(
    graph: &mut SessionStateGraph,
    event: &ProviderEvent,
    tool_call: &ToolCallData,
    scope: &TranscriptScope,
    turn_key: &str,
    parent_operation_id: Option<String>,
    parent_tool_call_id: Option<String>,
) -> Option<OperationSnapshot> {
    if should_skip_unanswered_question_tool_operation(tool_call) {
        return None;
    }

    let operation = apply_single_tool_call(
        graph,
        event,
        tool_call,
        scope,
        turn_key,
        parent_operation_id,
        parent_tool_call_id,
    );

    link_operation_to_parent(graph, &operation);
    repair_existing_children_for_parent(graph, &operation);

    if let Some(children) = tool_call.task_children.as_ref() {
        let child_scope = TranscriptScope::Operation(operation.id.clone());
        let child_turn_key = operation_session_start_turn_key(&operation.id);
        for child in children {
            let child = tool_call_with_parent_fallback(child, &operation.tool_call_id);
            let child = normalize_tool_call_for_operation_ingress(&child);
            let _ = apply_tool_call_with_children(
                graph,
                event,
                &child,
                &child_scope,
                &child_turn_key,
                Some(operation.id.clone()),
                Some(operation.tool_call_id.clone()),
            );
        }
    }

    find_operation_by_id(graph, &operation.id).or(Some(operation))
}

fn apply_single_tool_call(
    graph: &mut SessionStateGraph,
    event: &ProviderEvent,
    tool_call: &ToolCallData,
    scope: &TranscriptScope,
    turn_key: &str,
    parent_operation_id: Option<String>,
    parent_tool_call_id: Option<String>,
) -> OperationSnapshot {
    let session_id = graph.canonical_session_id.clone();
    let entry_id = resolve_tool_transcript_entry_id(graph, &tool_call.id, turn_key);

    append_tool_transcript_entry(graph, event, &entry_id, scope, tool_call);

    let source_link = OperationSourceLink::transcript_linked(entry_id);
    let operation = build_operation_from_tool_call(
        &session_id,
        graph.operations.len(),
        tool_call,
        parent_operation_id,
        parent_tool_call_id,
        source_link,
    );
    let operation = upsert_operation(graph, operation);
    register_plan_approval_interaction(graph, tool_call);
    register_question_interaction(graph, tool_call, graph.revision.graph_revision);
    operation
}

fn parent_link_from_tool_call_parent(
    graph: &SessionStateGraph,
    tool_call: &ToolCallData,
) -> ParentOperationLink {
    let Some(parent_tool_call_id) = tool_call.parent_tool_use_id.clone() else {
        return ParentOperationLink::default();
    };
    let parent_operation_id = graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == parent_tool_call_id)
        .map(|operation| operation.id.clone());

    ParentOperationLink {
        parent_operation_id,
        parent_tool_call_id: Some(parent_tool_call_id),
    }
}

fn tool_call_with_parent_fallback(
    tool_call: &ToolCallData,
    parent_tool_call_id: &str,
) -> ToolCallData {
    let mut with_parent = tool_call.clone();
    if with_parent.parent_tool_use_id.is_none() {
        with_parent.parent_tool_use_id = Some(parent_tool_call_id.to_string());
    }
    with_parent
}

fn operation_session_start_turn_key(operation_id: &str) -> String {
    format!(
        "operation:{}:{}",
        operation_id,
        turn_key_for_assistant_boundary(0)
    )
}

fn link_operation_to_parent(graph: &mut SessionStateGraph, operation: &OperationSnapshot) {
    let Some(parent_operation_id) = operation.parent_operation_id.clone() else {
        return;
    };
    attach_child_link_to_parent(
        graph,
        &parent_operation_id,
        &operation.tool_call_id,
        &operation.id,
    );
}

fn repair_existing_children_for_parent(graph: &mut SessionStateGraph, parent: &OperationSnapshot) {
    let children: Vec<(String, String)> = graph
        .operations
        .iter()
        .filter(|operation| operation.id != parent.id)
        .filter(|operation| {
            operation
                .parent_tool_call_id
                .as_deref()
                .is_some_and(|parent_tool_call_id| parent_tool_call_id == parent.tool_call_id)
        })
        .map(|operation| (operation.id.clone(), operation.tool_call_id.clone()))
        .collect();

    for (child_operation_id, child_tool_call_id) in children {
        set_child_parent_operation_id(graph, &child_operation_id, &parent.id);
        attach_child_link_to_parent(graph, &parent.id, &child_tool_call_id, &child_operation_id);
    }
}

fn set_child_parent_operation_id(
    graph: &mut SessionStateGraph,
    child_operation_id: &str,
    parent_operation_id: &str,
) {
    let Some(index) = graph
        .operations
        .iter()
        .position(|operation| operation.id == child_operation_id)
    else {
        return;
    };

    if graph.operations[index].parent_operation_id.as_deref() == Some(parent_operation_id) {
        return;
    }

    graph.operations[index].parent_operation_id = Some(parent_operation_id.to_string());
    graph.revision.graph_revision += 1;
}

fn attach_child_link_to_parent(
    graph: &mut SessionStateGraph,
    parent_operation_id: &str,
    child_tool_call_id: &str,
    child_operation_id: &str,
) {
    let Some(index) = graph
        .operations
        .iter()
        .position(|operation| operation.id == parent_operation_id)
    else {
        return;
    };

    let mut changed = false;
    if !graph.operations[index]
        .child_tool_call_ids
        .iter()
        .any(|id| id == child_tool_call_id)
    {
        graph.operations[index]
            .child_tool_call_ids
            .push(child_tool_call_id.to_string());
        changed = true;
    }
    if !graph.operations[index]
        .child_operation_ids
        .iter()
        .any(|id| id == child_operation_id)
    {
        graph.operations[index]
            .child_operation_ids
            .push(child_operation_id.to_string());
        changed = true;
    }

    if changed {
        graph.revision.graph_revision += 1;
    }
}

fn find_operation_by_id(
    graph: &SessionStateGraph,
    operation_id: &str,
) -> Option<OperationSnapshot> {
    graph
        .operations
        .iter()
        .find(|operation| operation.id == operation_id)
        .cloned()
}

fn upsert_operation(
    graph: &mut SessionStateGraph,
    operation: OperationSnapshot,
) -> OperationSnapshot {
    let operation = if let Some(index) = graph
        .operations
        .iter()
        .position(|existing| existing.id == operation.id)
    {
        let existing = graph.operations[index].clone();
        let next =
            strip_fold_operation_timing(finalize_operation_snapshot(Some(&existing), operation));
        graph.operations[index] = next.clone();
        next
    } else if let Some(index) = find_operation_index_by_tool_call(graph, &operation.tool_call_id) {
        let existing = graph.operations[index].clone();
        let next =
            strip_fold_operation_timing(finalize_operation_snapshot(Some(&existing), operation));
        graph.operations[index] = next.clone();
        next
    } else {
        let next = strip_fold_operation_timing(finalize_operation_snapshot(None, operation));
        graph.operations.push(next.clone());
        next
    };
    graph.revision.graph_revision += 1;
    operation
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
            !graph.operations.is_empty(),
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
