use crate::acp::projections::{InteractionSnapshot, OperationSnapshot, OperationSourceLink};
use crate::acp::session_state_engine::graph::ActiveStreamingTail;
use crate::acp::transcript_projection::{
    TranscriptEntry, TranscriptEntryRole, TranscriptScope, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::transcript_viewport::row::{
    TranscriptViewportInteractionLink, TranscriptViewportOperationDisplayFacts,
    TranscriptViewportOperationLink, TranscriptViewportRow, TranscriptViewportRowContent,
    TranscriptViewportRowKind,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[must_use]
pub fn project_transcript_viewport_rows(
    transcript_snapshot: &TranscriptSnapshot,
    operations: &[OperationSnapshot],
    interactions: &[InteractionSnapshot],
    active_streaming_tail: Option<&ActiveStreamingTail>,
    awaiting_duration_started_at_ms: Option<u64>,
) -> Vec<TranscriptViewportRow> {
    project_transcript_viewport_rows_for_scope(
        transcript_snapshot,
        operations,
        interactions,
        active_streaming_tail,
        awaiting_duration_started_at_ms,
        &TranscriptScope::Root,
    )
}

#[must_use]
pub fn project_transcript_viewport_rows_for_scope(
    transcript_snapshot: &TranscriptSnapshot,
    operations: &[OperationSnapshot],
    interactions: &[InteractionSnapshot],
    active_streaming_tail: Option<&ActiveStreamingTail>,
    awaiting_duration_started_at_ms: Option<u64>,
    scope: &TranscriptScope,
) -> Vec<TranscriptViewportRow> {
    project_transcript_viewport_entry_rows_for_scope(
        &transcript_snapshot.entries,
        operations,
        interactions,
        active_streaming_tail,
        awaiting_duration_started_at_ms,
        scope,
    )
}

#[must_use]
pub(crate) fn project_transcript_viewport_entry_rows(
    entries: &[TranscriptEntry],
    operations: &[OperationSnapshot],
    interactions: &[InteractionSnapshot],
    active_streaming_tail: Option<&ActiveStreamingTail>,
    awaiting_duration_started_at_ms: Option<u64>,
) -> Vec<TranscriptViewportRow> {
    project_transcript_viewport_entry_rows_for_scope(
        entries,
        operations,
        interactions,
        active_streaming_tail,
        awaiting_duration_started_at_ms,
        &TranscriptScope::Root,
    )
}

fn project_transcript_viewport_entry_rows_for_scope(
    entries: &[TranscriptEntry],
    operations: &[OperationSnapshot],
    interactions: &[InteractionSnapshot],
    active_streaming_tail: Option<&ActiveStreamingTail>,
    awaiting_duration_started_at_ms: Option<u64>,
    scope: &TranscriptScope,
) -> Vec<TranscriptViewportRow> {
    let normalized_entries = normalize_entry_scopes(entries, operations);
    let operation_links_by_entry = operation_links_by_entry_id(&normalized_entries, operations);
    let interaction_links_by_operation = interaction_links_by_operation_id(interactions);

    normalized_entries
        .iter()
        .filter(|entry| &entry.scope == scope)
        .filter_map(|entry| {
            project_entry(
                entry,
                &operation_links_by_entry,
                &interaction_links_by_operation,
                active_streaming_tail,
                awaiting_duration_started_at_ms,
            )
        })
        .collect()
}

fn normalize_entry_scopes(
    entries: &[TranscriptEntry],
    operations: &[OperationSnapshot],
) -> Vec<TranscriptEntry> {
    let operation_id_by_tool_call_id = operation_id_by_tool_call_id(operations);
    entries
        .iter()
        .map(|entry| normalize_entry_scope(entry, &operation_id_by_tool_call_id))
        .collect()
}

fn normalize_entry_scope(
    entry: &TranscriptEntry,
    operation_id_by_tool_call_id: &BTreeMap<String, String>,
) -> TranscriptEntry {
    let TranscriptScope::Operation(scope_id) = &entry.scope else {
        return entry.clone();
    };
    let Some(operation_id) = operation_id_by_tool_call_id.get(scope_id) else {
        return entry.clone();
    };
    if operation_id == scope_id {
        return entry.clone();
    }

    TranscriptEntry {
        entry_id: entry.entry_id.clone(),
        scope: TranscriptScope::Operation(operation_id.clone()),
        role: entry.role.clone(),
        segments: entry.segments.clone(),
        attempt_id: entry.attempt_id.clone(),
        timestamp_ms: entry.timestamp_ms,
    }
}

fn operation_id_by_tool_call_id(operations: &[OperationSnapshot]) -> BTreeMap<String, String> {
    let mut ids = BTreeMap::new();
    for operation in operations {
        ids.insert(operation.tool_call_id.clone(), operation.id.clone());
    }
    ids
}

fn project_entry(
    entry: &TranscriptEntry,
    operation_links_by_entry: &BTreeMap<String, Vec<TranscriptViewportOperationLink>>,
    interaction_links_by_operation: &BTreeMap<String, Vec<TranscriptViewportInteractionLink>>,
    active_streaming_tail: Option<&ActiveStreamingTail>,
    awaiting_duration_started_at_ms: Option<u64>,
) -> Option<TranscriptViewportRow> {
    let entry_id = entry.entry_id.trim();
    if entry_id.is_empty() {
        return None;
    }

    let mut operation_links = operation_links_by_entry
        .get(entry_id)
        .cloned()
        .unwrap_or_default();
    let interaction_links = interaction_links_for_operations(
        operation_links.as_slice(),
        interaction_links_by_operation,
    );
    attach_interaction_ids_to_operation_display_facts(
        operation_links.as_mut_slice(),
        interaction_links.as_slice(),
    );
    let kind = row_kind(entry);
    let active_streaming_tail =
        active_streaming_tail.and_then(|tail| active_tail_kind_for_entry(tail, entry_id));
    let content = row_content(entry);
    let version = row_version(
        entry_id,
        &entry.scope,
        &kind,
        active_streaming_tail,
        operation_links.as_slice(),
        interaction_links.as_slice(),
        &content,
        entry.timestamp_ms,
    );

    let duration_started_at_ms = if active_streaming_tail.is_some() {
        awaiting_duration_started_at_ms
    } else {
        None
    };

    Some(TranscriptViewportRow {
        row_id: format!("transcript:{}:{entry_id}", entry.scope.ledger_key()),
        source_entry_id: entry_id.to_string(),
        scope: entry.scope.clone(),
        kind,
        version,
        anchor_eligible: true,
        active_streaming_tail,
        operation_links,
        interaction_links,
        content,
        duration_started_at_ms,
        timestamp_ms: entry.timestamp_ms,
    })
}

fn active_tail_kind_for_entry(
    active_streaming_tail: &ActiveStreamingTail,
    entry_id: &str,
) -> Option<crate::acp::session_state_engine::graph::ActiveStreamingTailContentKind> {
    if active_streaming_tail.row_id == entry_id {
        return Some(active_streaming_tail.content_kind);
    }

    None
}

fn row_kind(entry: &TranscriptEntry) -> TranscriptViewportRowKind {
    match entry.role {
        TranscriptEntryRole::User => TranscriptViewportRowKind::User,
        TranscriptEntryRole::Tool => TranscriptViewportRowKind::Tool,
        TranscriptEntryRole::SessionActivity => TranscriptViewportRowKind::SessionActivity,
        TranscriptEntryRole::Assistant => {
            if entry
                .segments
                .iter()
                .all(|segment| matches!(segment, TranscriptSegment::Thought { .. }))
            {
                return TranscriptViewportRowKind::AssistantThought;
            }

            TranscriptViewportRowKind::AssistantText
        }
    }
}

fn row_content(entry: &TranscriptEntry) -> TranscriptViewportRowContent {
    if entry.role == TranscriptEntryRole::SessionActivity {
        if let Some(event) = entry.segments.iter().find_map(|segment| match segment {
            TranscriptSegment::Compaction { event, .. } => Some(event.clone()),
            _ => None,
        }) {
            return TranscriptViewportRowContent::Compaction { event };
        }
    }

    TranscriptViewportRowContent::Transcript {
        role: entry.role.clone(),
        segments: entry.segments.clone(),
    }
}

fn operation_links_by_entry_id(
    entries: &[TranscriptEntry],
    operations: &[OperationSnapshot],
) -> BTreeMap<String, Vec<TranscriptViewportOperationLink>> {
    let scoped_children = scoped_child_operations_by_parent(entries, operations);
    let mut links_by_entry = BTreeMap::new();

    for operation in operations {
        let OperationSourceLink::TranscriptLinked { entry_id } = &operation.source_link else {
            continue;
        };
        let mut display_facts =
            TranscriptViewportOperationDisplayFacts::from_operation(operation, Vec::new());
        if let (Some(display_facts), Some(children)) =
            (display_facts.as_mut(), scoped_children.get(&operation.id))
        {
            display_facts.attach_scoped_children(children);
        }
        links_by_entry
            .entry(entry_id.clone())
            .or_insert_with(Vec::new)
            .push(TranscriptViewportOperationLink {
                operation_id: operation.id.clone(),
                tool_call_id: operation.tool_call_id.clone(),
                name: operation.name.clone(),
                state: operation.operation_state.clone(),
                display_facts,
                operation: None,
            });
    }

    for links in links_by_entry.values_mut() {
        links.sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
    }

    links_by_entry
}

fn scoped_child_operations_by_parent(
    entries: &[TranscriptEntry],
    operations: &[OperationSnapshot],
) -> BTreeMap<String, Vec<OperationSnapshot>> {
    let mut operations_by_entry = BTreeMap::<String, Vec<&OperationSnapshot>>::new();
    for operation in operations {
        let OperationSourceLink::TranscriptLinked { entry_id } = &operation.source_link else {
            continue;
        };
        operations_by_entry
            .entry(entry_id.clone())
            .or_default()
            .push(operation);
    }

    let mut scoped_children = BTreeMap::<String, Vec<OperationSnapshot>>::new();
    for entry in entries {
        let TranscriptScope::Operation(parent_operation_id) = &entry.scope else {
            continue;
        };
        let Some(operations) = operations_by_entry.get(&entry.entry_id) else {
            continue;
        };
        scoped_children
            .entry(parent_operation_id.clone())
            .or_default()
            .extend(operations.iter().map(|operation| (*operation).clone()));
    }

    scoped_children
}

fn interaction_links_by_operation_id(
    interactions: &[InteractionSnapshot],
) -> BTreeMap<String, Vec<TranscriptViewportInteractionLink>> {
    let mut links_by_operation = BTreeMap::new();

    for interaction in interactions {
        let Some(operation_id) = &interaction.canonical_operation_id else {
            continue;
        };
        links_by_operation
            .entry(operation_id.clone())
            .or_insert_with(Vec::new)
            .push(TranscriptViewportInteractionLink {
                interaction_id: interaction.id.clone(),
                kind: interaction.kind.clone(),
                state: interaction.state.clone(),
                operation_id: Some(operation_id.clone()),
            });
    }

    for links in links_by_operation.values_mut() {
        links.sort_by(|left, right| left.interaction_id.cmp(&right.interaction_id));
    }

    links_by_operation
}

fn interaction_links_for_operations(
    operation_links: &[TranscriptViewportOperationLink],
    interaction_links_by_operation: &BTreeMap<String, Vec<TranscriptViewportInteractionLink>>,
) -> Vec<TranscriptViewportInteractionLink> {
    let mut interaction_links = Vec::new();

    for operation_link in operation_links {
        if let Some(links) = interaction_links_by_operation.get(&operation_link.operation_id) {
            interaction_links.extend(links.iter().cloned());
        }
    }

    interaction_links
}

fn attach_interaction_ids_to_operation_display_facts(
    operation_links: &mut [TranscriptViewportOperationLink],
    interaction_links: &[TranscriptViewportInteractionLink],
) {
    for operation_link in operation_links {
        let Some(display_facts) = operation_link.display_facts.as_mut() else {
            continue;
        };
        display_facts.interaction_ids = interaction_links
            .iter()
            .filter(|interaction_link| {
                interaction_link
                    .operation_id
                    .as_ref()
                    .is_some_and(|operation_id| operation_id == &operation_link.operation_id)
            })
            .map(|interaction_link| interaction_link.interaction_id.clone())
            .collect();
    }
}

fn row_version(
    entry_id: &str,
    scope: &TranscriptScope,
    kind: &TranscriptViewportRowKind,
    active_streaming_tail: Option<
        crate::acp::session_state_engine::graph::ActiveStreamingTailContentKind,
    >,
    operation_links: &[TranscriptViewportOperationLink],
    interaction_links: &[TranscriptViewportInteractionLink],
    content: &TranscriptViewportRowContent,
    timestamp_ms: Option<i64>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(entry_id.as_bytes());
    hasher.update(scope.ledger_key().as_bytes());
    hasher.update(format!("{kind:?}").as_bytes());
    hasher.update(format!("{active_streaming_tail:?}").as_bytes());
    // Include timestamp in the version so ledgers rebuild when wall-clock
    // time is added to the row payload (or when it changes).
    hasher.update(b"timestamp_ms");
    match timestamp_ms {
        Some(value) => hasher.update(value.to_string().as_bytes()),
        None => hasher.update(b"none"),
    }

    for operation_link in operation_links {
        hasher.update(operation_link.operation_id.as_bytes());
        hasher.update(operation_link.tool_call_id.as_bytes());
        hasher.update(operation_link.name.as_bytes());
        hasher.update(format!("{:?}", operation_link.state).as_bytes());
        if let Some(display_facts) = &operation_link.display_facts {
            hasher.update(display_facts.operation_id.as_bytes());
            hasher.update(display_facts.tool_call_id.as_bytes());
            hasher.update(display_facts.name.as_bytes());
            hasher.update(display_facts.title.as_bytes());
            hasher.update(format!("{:?}", display_facts.state).as_bytes());
            hasher.update(format!("{:?}", display_facts.kind).as_bytes());
            hasher.update(format!("{:?}", display_facts.skill_name).as_bytes());
            hasher.update(format!("{:?}", display_facts.skill_args).as_bytes());
            hasher.update(format!("{:?}", display_facts.task_description).as_bytes());
            hasher.update(format!("{:?}", display_facts.task_prompt).as_bytes());
            hasher.update(format!("{:?}", display_facts.subagent_type).as_bytes());
            hasher.update(format!("{:?}", display_facts.normalized_todos).as_bytes());
            hasher.update(format!("{:?}", display_facts.edit_diffs).as_bytes());
            if let Some(command_summary) = &display_facts.command_summary {
                hasher.update(command_summary.as_bytes());
            }
            if let Some(target_path_summary) = &display_facts.target_path_summary {
                hasher.update(target_path_summary.as_bytes());
            }
            if let Some(result_summary) = &display_facts.result_summary {
                hasher.update(result_summary.as_bytes());
            }
            if let Some(error_summary) = &display_facts.error_summary {
                hasher.update(error_summary.as_bytes());
            }
            for interaction_id in &display_facts.interaction_ids {
                hasher.update(interaction_id.as_bytes());
            }
            if let Some(parent_tool_call_id) = &display_facts.parent_tool_call_id {
                hasher.update(parent_tool_call_id.as_bytes());
            }
            for child_tool_call_id in &display_facts.child_tool_call_ids {
                hasher.update(child_tool_call_id.as_bytes());
            }
            hasher.update(format!("{:?}", display_facts.child_transcript_scope).as_bytes());
            hasher.update(format!("{:?}", display_facts.latest_child_action).as_bytes());
        }
    }

    for interaction_link in interaction_links {
        hasher.update(interaction_link.interaction_id.as_bytes());
        hasher.update(format!("{:?}", interaction_link.kind).as_bytes());
        hasher.update(format!("{:?}", interaction_link.state).as_bytes());
        if let Some(operation_id) = &interaction_link.operation_id {
            hasher.update(operation_id.as_bytes());
        }
    }

    match content {
        TranscriptViewportRowContent::Transcript { role, segments } => {
            hasher.update(format!("{role:?}").as_bytes());
            for segment in segments {
                hash_segment(&mut hasher, segment);
            }
        }
        TranscriptViewportRowContent::Compaction { event } => {
            hasher.update(b"compaction");
            hasher.update(event.event_id.as_bytes());
            hasher.update(event.session_id.as_bytes());
            hasher.update(format!("{:?}", event.status).as_bytes());
            hasher.update(format!("{:?}", event.trigger).as_bytes());
            if let Some(tokens) = event.pre_compaction_tokens {
                hasher.update(tokens.to_string().as_bytes());
            }
            if let Some(tokens) = event.post_compaction_tokens {
                hasher.update(tokens.to_string().as_bytes());
            }
            if let Some(tokens) = event.dropped_tokens {
                hasher.update(tokens.to_string().as_bytes());
            }
            if let Some(size) = event.context_window_size {
                hasher.update(size.to_string().as_bytes());
            }
            if let Some(duration_ms) = event.duration_ms {
                hasher.update(duration_ms.to_string().as_bytes());
            }
            if let Some(precomputed) = event.precomputed {
                hasher.update(precomputed.to_string().as_bytes());
            }
            if let Some(count) = event.preserved_message_count {
                hasher.update(count.to_string().as_bytes());
            }
            if let Some(tokens) = event.cumulative_dropped_tokens {
                hasher.update(tokens.to_string().as_bytes());
            }
            if let Some(timestamp_ms) = event.timestamp_ms {
                hasher.update(timestamp_ms.to_string().as_bytes());
            }
            if let Some(summary) = &event.summary {
                hasher.update(summary.as_bytes());
            }
        }
    }

    hex::encode(&hasher.finalize()[..16])
}

pub(crate) fn canonical_transcript_viewport_row_version(row: &TranscriptViewportRow) -> String {
    row_version(
        &row.source_entry_id,
        &row.scope,
        &row.kind,
        row.active_streaming_tail,
        &row.operation_links,
        &row.interaction_links,
        &row.content,
        row.timestamp_ms,
    )
}

fn hash_segment(hasher: &mut Sha256, segment: &TranscriptSegment) {
    match segment {
        TranscriptSegment::Text { segment_id, text } => {
            hasher.update(b"text");
            hasher.update(segment_id.as_bytes());
            hasher.update(text.as_bytes());
        }
        TranscriptSegment::Thought { segment_id, text } => {
            hasher.update(b"thought");
            hasher.update(segment_id.as_bytes());
            hasher.update(text.as_bytes());
        }
        TranscriptSegment::PastedContent { segment_id, text } => {
            hasher.update(b"pastedContent");
            hasher.update(segment_id.as_bytes());
            hasher.update(text.as_bytes());
        }
        TranscriptSegment::LocalCommand {
            segment_id,
            command,
            message,
            args,
            stdout,
            model_display_name,
            model_description,
        } => {
            hasher.update(b"localCommand");
            hasher.update(segment_id.as_bytes());
            hasher.update(command.as_bytes());
            hasher.update(message.as_bytes());
            hasher.update(args.as_bytes());
            hasher.update(stdout.as_bytes());
            if let Some(name) = model_display_name {
                hasher.update(name.as_bytes());
            }
            if let Some(description) = model_description {
                hasher.update(description.as_bytes());
            }
        }
        TranscriptSegment::Compaction { segment_id, event } => {
            hasher.update(b"compactionSegment");
            hasher.update(segment_id.as_bytes());
            hasher.update(event.event_id.as_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::project_transcript_viewport_rows;
    use crate::acp::projections::{
        InteractionKind, InteractionPayload, InteractionSnapshot, InteractionState,
        OperationSnapshot, OperationSourceLink, OperationState,
    };
    use crate::acp::session_state_engine::graph::{
        ActiveStreamingTail, ActiveStreamingTailContentKind,
    };
    use crate::acp::session_update::{
        PermissionData, SessionCompactionEvent, SessionCompactionStatus, SessionCompactionTrigger,
        ToolArguments, ToolCallStatus,
    };
    use crate::acp::transcript_projection::{
        TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
    };
    use crate::acp::transcript_viewport::row::{
        TranscriptViewportRowContent, TranscriptViewportRowKind,
    };
    use serde_json::{json, Value};

    fn text_entry(entry_id: &str, role: TranscriptEntryRole, text: &str) -> TranscriptEntry {
        TranscriptEntry {
            scope: crate::acp::transcript_projection::TranscriptScope::Root,
            entry_id: entry_id.to_string(),
            role,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:text:0"),
                text: text.to_string(),
            }],
            attempt_id: None,
            timestamp_ms: None,
        }
    }

    fn thought_entry(entry_id: &str, text: &str) -> TranscriptEntry {
        TranscriptEntry {
            scope: crate::acp::transcript_projection::TranscriptScope::Root,
            entry_id: entry_id.to_string(),
            role: TranscriptEntryRole::Assistant,
            segments: vec![TranscriptSegment::Thought {
                segment_id: format!("{entry_id}:thought:0"),
                text: text.to_string(),
            }],
            attempt_id: None,
            timestamp_ms: None,
        }
    }

    fn snapshot(entries: Vec<TranscriptEntry>) -> TranscriptSnapshot {
        TranscriptSnapshot {
            revision: entries.len() as i64,
            entries,
        }
    }

    fn linked_operation(entry_id: &str, state: OperationState) -> OperationSnapshot {
        OperationSnapshot {
            id: format!("op:{entry_id}"),
            session_id: "session-1".to_string(),
            tool_call_id: format!("tool:{entry_id}"),
            name: "bash".to_string(),
            kind: None,
            provider_status: ToolCallStatus::Completed,
            title: None,
            arguments: ToolArguments::Other {
                raw: Value::Null,
                intent: None,
            },
            progressive_arguments: None,
            result: None,
            command: None,
            normalized_todos: None,
            computer_payload: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: Vec::new(),
            child_operation_ids: Vec::new(),
            operation_provenance_key: Some(entry_id.to_string()),
            operation_state: state,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_link: OperationSourceLink::TranscriptLinked {
                entry_id: entry_id.to_string(),
            },
            degradation_reason: None,
        }
    }

    fn permission_interaction(interaction_id: &str, operation_id: &str) -> InteractionSnapshot {
        InteractionSnapshot {
            id: interaction_id.to_string(),
            session_id: "session-1".to_string(),
            kind: InteractionKind::Permission,
            state: InteractionState::Pending,
            json_rpc_request_id: Some(1),
            reply_handler: None,
            tool_reference: None,
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::Permission(PermissionData {
                id: interaction_id.to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(1),
                reply_handler: None,
                permission: "execute".to_string(),
                patterns: vec!["echo hi".to_string()],
                metadata: json!({ "command": "echo hi" }),
                always: Vec::new(),
                auto_accepted: false,
                tool: None,
            }),
            canonical_operation_id: Some(operation_id.to_string()),
        }
    }

    #[test]
    fn projects_entry_timestamp_ms_onto_viewport_row() {
        let mut entry = text_entry("user-1", TranscriptEntryRole::User, "hello");
        entry.timestamp_ms = Some(1770000000000_i64);
        let rows = project_transcript_viewport_rows(&snapshot(vec![entry]), &[], &[], None, None);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].timestamp_ms, Some(1770000000000_i64));
    }

    #[test]
    fn projects_canonical_transcript_entries_into_stable_viewport_rows() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![
                text_entry("user-1", TranscriptEntryRole::User, "build it"),
                text_entry("assistant-1", TranscriptEntryRole::Assistant, "working"),
                thought_entry("thought-1", "thinking"),
                text_entry("tool-1", TranscriptEntryRole::Tool, "bash"),
            ]),
            &[linked_operation("tool-1", OperationState::Running)],
            &[permission_interaction("permission-1", "op:tool-1")],
            Some(&ActiveStreamingTail {
                row_id: "assistant-1".to_string(),
                content_kind: ActiveStreamingTailContentKind::Message,
            }),
            None,
        );

        assert_eq!(
            rows.iter()
                .map(|row| (&row.row_id, &row.kind))
                .collect::<Vec<_>>(),
            vec![
                (
                    &"transcript:root:user-1".to_string(),
                    &TranscriptViewportRowKind::User
                ),
                (
                    &"transcript:root:assistant-1".to_string(),
                    &TranscriptViewportRowKind::AssistantText
                ),
                (
                    &"transcript:root:thought-1".to_string(),
                    &TranscriptViewportRowKind::AssistantThought
                ),
                (
                    &"transcript:root:tool-1".to_string(),
                    &TranscriptViewportRowKind::Tool
                ),
            ]
        );
        assert_eq!(
            rows[1].active_streaming_tail,
            Some(ActiveStreamingTailContentKind::Message)
        );
        assert_eq!(rows[3].operation_links[0].operation_id, "op:tool-1");
        assert_eq!(rows[3].interaction_links[0].interaction_id, "permission-1");
    }

    #[test]
    fn projects_compaction_entries_into_session_activity_rows() {
        let event = SessionCompactionEvent {
            event_id: "compact-1".to_string(),
            session_id: "session-1".to_string(),
            status: SessionCompactionStatus::Completed,
            trigger: SessionCompactionTrigger::Auto,
            pre_compaction_tokens: Some(180000),
            post_compaction_tokens: Some(42000),
            dropped_tokens: Some(138000),
            context_window_size: Some(200000),
            duration_ms: Some(918),
            precomputed: Some(true),
            preserved_message_count: Some(2),
            cumulative_dropped_tokens: Some(138000),
            timestamp_ms: Some(1770000000000_i64),
            summary: Some("Compaction done".to_string()),
            provider_metadata: serde_json::json!({ "subtype": "compact_boundary" }),
        };
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: "compact-entry-1".to_string(),
                role: TranscriptEntryRole::SessionActivity,
                segments: vec![TranscriptSegment::Compaction {
                    segment_id: "compact-entry-1:compaction".to_string(),
                    event: event.clone(),
                }],
                attempt_id: None,
                timestamp_ms: Some(1770000000000_i64),
            }]),
            &[],
            &[],
            None,
            None,
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, TranscriptViewportRowKind::SessionActivity);
        let TranscriptViewportRowContent::Compaction { event: row_event } = &rows[0].content else {
            panic!("expected compaction row content");
        };
        assert_eq!(row_event, &event);
    }

    #[test]
    fn provider_reused_assistant_ids_do_not_merge_or_reorder_rows() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![
                text_entry(
                    "display-assistant-text",
                    TranscriptEntryRole::Assistant,
                    "done",
                ),
                text_entry("display-tool-1", TranscriptEntryRole::Tool, "bash"),
                text_entry("display-tool-2", TranscriptEntryRole::Tool, "read"),
            ]),
            &[
                linked_operation("display-tool-1", OperationState::Completed),
                linked_operation("display-tool-2", OperationState::Completed),
            ],
            &[],
            None,
            None,
        );

        assert_eq!(
            rows.iter()
                .map(|row| row.source_entry_id.as_str())
                .collect::<Vec<_>>(),
            vec!["display-assistant-text", "display-tool-1", "display-tool-2"]
        );
    }

    #[test]
    fn operation_enrichment_changes_version_without_changing_row_identity() {
        let transcript = snapshot(vec![text_entry(
            "tool-1",
            TranscriptEntryRole::Tool,
            "bash",
        )]);
        let running_rows = project_transcript_viewport_rows(
            &transcript,
            &[linked_operation("tool-1", OperationState::Running)],
            &[],
            None,
            None,
        );
        let completed_rows = project_transcript_viewport_rows(
            &transcript,
            &[linked_operation("tool-1", OperationState::Completed)],
            &[],
            None,
            None,
        );

        assert_eq!(running_rows[0].row_id, completed_rows[0].row_id);
        assert_ne!(running_rows[0].version, completed_rows[0].version);
    }

    #[test]
    fn empty_canonical_identity_is_not_repaired_in_viewport_projection() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![text_entry(
                "",
                TranscriptEntryRole::Assistant,
                "orphan",
            )]),
            &[],
            &[],
            None,
            None,
        );

        assert!(rows.is_empty());
    }

    #[test]
    fn row_content_preserves_transcript_segments_without_provider_lookup() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![text_entry(
                "assistant-1",
                TranscriptEntryRole::Assistant,
                "hello",
            )]),
            &[],
            &[],
            None,
            None,
        );

        let TranscriptViewportRowContent::Transcript { role, segments } = &rows[0].content else {
            panic!("expected transcript row content");
        };
        assert_eq!(role, &TranscriptEntryRole::Assistant);
        assert_eq!(
            segments,
            &vec![TranscriptSegment::Text {
                segment_id: "assistant-1:text:0".to_string(),
                text: "hello".to_string()
            }]
        );
    }

    #[test]
    fn duplicate_entry_ids_project_with_identical_row_ids_without_dup_suffix() {
        // Authority-owned ids are unique upstream; the viewport no longer suffixes
        // colliding row ids — duplicate source entry ids would surface as duplicate
        // row ids (a data bug), not be masked downstream.
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![
                text_entry("toolu_bdrk_dup", TranscriptEntryRole::Tool, "first"),
                text_entry("toolu_bdrk_dup", TranscriptEntryRole::Tool, "second"),
                text_entry("toolu_bdrk_dup", TranscriptEntryRole::Tool, "third"),
            ]),
            &[],
            &[],
            None,
            None,
        );

        assert_eq!(rows.len(), 3, "no row is dropped");
        assert!(rows
            .iter()
            .all(|row| row.row_id == "transcript:root:toolu_bdrk_dup"));
        for row in &rows {
            assert_eq!(row.source_entry_id, "toolu_bdrk_dup");
        }
    }

    #[test]
    fn streaming_assistant_row_receives_awaiting_duration_started_at_ms() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![
                text_entry("user-1", TranscriptEntryRole::User, "prompt"),
                text_entry("assistant-1", TranscriptEntryRole::Assistant, ""),
            ]),
            &[],
            &[],
            Some(&ActiveStreamingTail {
                row_id: "assistant-1".to_string(),
                content_kind: ActiveStreamingTailContentKind::Message,
            }),
            Some(1_700_000_000_000),
        );

        let assistant = &rows[1];
        assert_eq!(assistant.duration_started_at_ms, Some(1_700_000_000_000));
        assert_eq!(
            assistant.active_streaming_tail,
            Some(ActiveStreamingTailContentKind::Message)
        );
    }

    #[test]
    fn non_streaming_assistant_row_has_no_duration_started_at_ms() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![text_entry(
                "assistant-1",
                TranscriptEntryRole::Assistant,
                "hello",
            )]),
            &[],
            &[],
            None,
            Some(1_700_000_000_000),
        );

        assert_eq!(rows[0].duration_started_at_ms, None);
    }

    #[test]
    fn canonical_projection_does_not_add_a_synthetic_waiting_row() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![text_entry(
                "user-1",
                TranscriptEntryRole::User,
                "prompt",
            )]),
            &[],
            &[],
            None,
            Some(1_700_000_000_000),
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, TranscriptViewportRowKind::User);
        assert_eq!(rows[0].row_id, "transcript:root:user-1");
    }
}
