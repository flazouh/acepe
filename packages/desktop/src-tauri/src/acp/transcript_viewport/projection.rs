use crate::acp::projections::{InteractionSnapshot, OperationSnapshot, OperationSourceLink};
use crate::acp::session_state_engine::graph::ActiveStreamingTail;
use crate::acp::transcript_projection::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::transcript_viewport::row::{
    TranscriptViewportInteractionLink, TranscriptViewportOperationLink, TranscriptViewportRow,
    TranscriptViewportRowContent, TranscriptViewportRowKind,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const AWAITING_PLACEHOLDER_ID: &str = "awaiting:planning";
const AWAITING_PLACEHOLDER_VERSION: &str = "00000000000000000000000000000000";

#[must_use]
pub fn project_transcript_viewport_rows(
    transcript_snapshot: &TranscriptSnapshot,
    operations: &[OperationSnapshot],
    interactions: &[InteractionSnapshot],
    active_streaming_tail: Option<&ActiveStreamingTail>,
    awaiting_placeholder: bool,
) -> Vec<TranscriptViewportRow> {
    let operation_links_by_entry = operation_links_by_entry_id(operations);
    let interaction_links_by_operation = interaction_links_by_operation_id(interactions);

    let mut rows: Vec<TranscriptViewportRow> = transcript_snapshot
        .entries
        .iter()
        .filter_map(|entry| {
            project_entry(
                entry,
                &operation_links_by_entry,
                &interaction_links_by_operation,
                active_streaming_tail,
            )
        })
        .collect();

    if awaiting_placeholder {
        rows.push(TranscriptViewportRow {
            row_id: AWAITING_PLACEHOLDER_ID.to_string(),
            source_entry_id: AWAITING_PLACEHOLDER_ID.to_string(),
            kind: TranscriptViewportRowKind::AwaitingPlaceholder,
            version: AWAITING_PLACEHOLDER_VERSION.to_string(),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: Vec::new(),
            },
        });
    }

    rows
}

fn project_entry(
    entry: &TranscriptEntry,
    operation_links_by_entry: &BTreeMap<String, Vec<TranscriptViewportOperationLink>>,
    interaction_links_by_operation: &BTreeMap<String, Vec<TranscriptViewportInteractionLink>>,
    active_streaming_tail: Option<&ActiveStreamingTail>,
) -> Option<TranscriptViewportRow> {
    let entry_id = entry.entry_id.trim();
    if entry_id.is_empty() {
        return None;
    }

    let operation_links = operation_links_by_entry
        .get(entry_id)
        .cloned()
        .unwrap_or_default();
    let interaction_links = interaction_links_for_operations(
        operation_links.as_slice(),
        interaction_links_by_operation,
    );
    let kind = row_kind(entry);
    let active_streaming_tail =
        active_streaming_tail.and_then(|tail| active_tail_kind_for_entry(tail, entry_id));
    let content = TranscriptViewportRowContent::Transcript {
        role: entry.role.clone(),
        segments: entry.segments.clone(),
    };
    let version = row_version(
        entry_id,
        &kind,
        active_streaming_tail,
        operation_links.as_slice(),
        interaction_links.as_slice(),
        &content,
    );

    Some(TranscriptViewportRow {
        row_id: format!("transcript:{entry_id}"),
        source_entry_id: entry_id.to_string(),
        kind,
        version,
        anchor_eligible: true,
        active_streaming_tail,
        operation_links,
        interaction_links,
        content,
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
        TranscriptEntryRole::Error => TranscriptViewportRowKind::Error,
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

fn operation_links_by_entry_id(
    operations: &[OperationSnapshot],
) -> BTreeMap<String, Vec<TranscriptViewportOperationLink>> {
    let mut links_by_entry = BTreeMap::new();

    for operation in operations {
        let OperationSourceLink::TranscriptLinked { entry_id } = &operation.source_link else {
            continue;
        };
        links_by_entry
            .entry(entry_id.clone())
            .or_insert_with(Vec::new)
            .push(TranscriptViewportOperationLink {
                operation_id: operation.id.clone(),
                tool_call_id: operation.tool_call_id.clone(),
                name: operation.name.clone(),
                state: operation.operation_state.clone(),
            });
    }

    for links in links_by_entry.values_mut() {
        links.sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
    }

    links_by_entry
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

fn row_version(
    entry_id: &str,
    kind: &TranscriptViewportRowKind,
    active_streaming_tail: Option<
        crate::acp::session_state_engine::graph::ActiveStreamingTailContentKind,
    >,
    operation_links: &[TranscriptViewportOperationLink],
    interaction_links: &[TranscriptViewportInteractionLink],
    content: &TranscriptViewportRowContent,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(entry_id.as_bytes());
    hasher.update(format!("{kind:?}").as_bytes());
    hasher.update(format!("{active_streaming_tail:?}").as_bytes());

    for operation_link in operation_links {
        hasher.update(operation_link.operation_id.as_bytes());
        hasher.update(operation_link.tool_call_id.as_bytes());
        hasher.update(operation_link.name.as_bytes());
        hasher.update(format!("{:?}", operation_link.state).as_bytes());
    }

    for interaction_link in interaction_links {
        hasher.update(interaction_link.interaction_id.as_bytes());
        hasher.update(format!("{:?}", interaction_link.kind).as_bytes());
        hasher.update(format!("{:?}", interaction_link.state).as_bytes());
        if let Some(operation_id) = &interaction_link.operation_id {
            hasher.update(operation_id.as_bytes());
        }
    }

    let TranscriptViewportRowContent::Transcript { role, segments } = content;
    hasher.update(format!("{role:?}").as_bytes());
    for segment in segments {
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
        }
    }

    hex::encode(&hasher.finalize()[..16])
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
    use crate::acp::session_update::{PermissionData, ToolArguments, ToolCallStatus};
    use crate::acp::transcript_projection::{
        TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
    };
    use crate::acp::transcript_viewport::row::{
        TranscriptViewportRowContent, TranscriptViewportRowKind,
    };
    use serde_json::{json, Value};

    fn text_entry(entry_id: &str, role: TranscriptEntryRole, text: &str) -> TranscriptEntry {
        TranscriptEntry {
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
    fn projects_canonical_transcript_entries_into_stable_viewport_rows() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![
                text_entry("user-1", TranscriptEntryRole::User, "build it"),
                text_entry("assistant-1", TranscriptEntryRole::Assistant, "working"),
                thought_entry("thought-1", "thinking"),
                text_entry("tool-1", TranscriptEntryRole::Tool, "bash"),
                text_entry("error-1", TranscriptEntryRole::Error, "failed"),
            ]),
            &[linked_operation("tool-1", OperationState::Running)],
            &[permission_interaction("permission-1", "op:tool-1")],
            Some(&ActiveStreamingTail {
                row_id: "assistant-1".to_string(),
                content_kind: ActiveStreamingTailContentKind::Message,
            }),
            false,
        );

        assert_eq!(
            rows.iter()
                .map(|row| (&row.row_id, &row.kind))
                .collect::<Vec<_>>(),
            vec![
                (
                    &"transcript:user-1".to_string(),
                    &TranscriptViewportRowKind::User
                ),
                (
                    &"transcript:assistant-1".to_string(),
                    &TranscriptViewportRowKind::AssistantText
                ),
                (
                    &"transcript:thought-1".to_string(),
                    &TranscriptViewportRowKind::AssistantThought
                ),
                (
                    &"transcript:tool-1".to_string(),
                    &TranscriptViewportRowKind::Tool
                ),
                (
                    &"transcript:error-1".to_string(),
                    &TranscriptViewportRowKind::Error
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
            false,
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
            false,
        );
        let completed_rows = project_transcript_viewport_rows(
            &transcript,
            &[linked_operation("tool-1", OperationState::Completed)],
            &[],
            None,
            false,
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
            false,
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
            false,
        );

        let TranscriptViewportRowContent::Transcript { role, segments } = &rows[0].content;
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
            false,
        );

        assert_eq!(rows.len(), 3, "no row is dropped");
        assert!(rows.iter().all(|row| row.row_id == "transcript:toolu_bdrk_dup"));
        for row in &rows {
            assert_eq!(row.source_entry_id, "toolu_bdrk_dup");
        }
    }

    #[test]
    fn awaiting_placeholder_appended_last_when_flag_true() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![
                text_entry("user-1", TranscriptEntryRole::User, "prompt"),
            ]),
            &[],
            &[],
            None,
            true,
        );

        assert_eq!(rows.len(), 2);
        let last = rows.last().unwrap();
        assert_eq!(last.kind, TranscriptViewportRowKind::AwaitingPlaceholder);
        assert_eq!(last.row_id, "awaiting:planning");
        assert_eq!(last.source_entry_id, "awaiting:planning");
    }

    #[test]
    fn awaiting_placeholder_not_emitted_when_flag_false() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![
                text_entry("user-1", TranscriptEntryRole::User, "prompt"),
            ]),
            &[],
            &[],
            None,
            false,
        );

        assert_eq!(rows.len(), 1);
        assert_ne!(rows[0].kind, TranscriptViewportRowKind::AwaitingPlaceholder);
    }

    #[test]
    fn awaiting_placeholder_version_is_constant_across_projections() {
        let snapshot = snapshot(vec![
            text_entry("user-1", TranscriptEntryRole::User, "prompt"),
        ]);
        let rows1 = project_transcript_viewport_rows(
            &snapshot, &[], &[], None, true,
        );
        let rows2 = project_transcript_viewport_rows(
            &snapshot, &[], &[], None, true,
        );

        let version1 = &rows1.last().unwrap().version;
        let version2 = &rows2.last().unwrap().version;
        assert_eq!(version1, version2, "awaiting row version is stable");
    }

    #[test]
    fn awaiting_placeholder_has_no_links_and_no_streaming_tail() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![
                text_entry("user-1", TranscriptEntryRole::User, "prompt"),
            ]),
            &[],
            &[],
            None,
            true,
        );

        let placeholder = rows.last().unwrap();
        assert!(placeholder.operation_links.is_empty());
        assert!(placeholder.interaction_links.is_empty());
        assert!(placeholder.active_streaming_tail.is_none());
        assert!(placeholder.anchor_eligible);
    }

    #[test]
    fn awaiting_placeholder_content_is_empty_transcript() {
        let rows = project_transcript_viewport_rows(
            &snapshot(vec![]),
            &[],
            &[],
            None,
            true,
        );

        let placeholder = &rows[0];
        let TranscriptViewportRowContent::Transcript { role, segments } = &placeholder.content;
        assert_eq!(role, &TranscriptEntryRole::Assistant);
        assert!(segments.is_empty());
    }

    #[test]
    fn awaiting_placeholder_id_survives_dedup_check() {
        let mut entries: Vec<TranscriptEntry> = (0..100)
            .map(|i| text_entry(&format!("entry-{}", i), TranscriptEntryRole::Tool, "x"))
            .collect();
        entries.push(text_entry("user-1", TranscriptEntryRole::User, "prompt"));
        let rows = project_transcript_viewport_rows(
            &snapshot(entries),
            &[],
            &[],
            None,
            true,
        );

        assert_eq!(rows.len(), 102);
        let row_ids: Vec<&str> = rows.iter().map(|r| r.row_id.as_str()).collect();
        let unique: std::collections::BTreeSet<&str> = row_ids.iter().copied().collect();
        assert_eq!(unique.len(), 102, "all row_ids are unique including awaiting:planning");
        assert!(
            rows.iter().any(|r| r.kind == TranscriptViewportRowKind::AwaitingPlaceholder),
            "awaiting placeholder row is present"
        );
    }
}
