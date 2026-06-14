use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::projections::{
    InteractionState, OperationSnapshot, OperationSourceLink, OperationState, ProjectionRegistry,
    SessionProjectionSnapshot, SessionTurnState,
};
use crate::acp::session_thread_snapshot::ProviderOwnedSessionSnapshot;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::{SessionUpdate, ToolCallData, ToolKind};
use crate::acp::transcript_projection::{
    tool_call_id_from_authority_entry_id, TranscriptEntryRole, TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::StoredEntry;
use std::collections::{HashMap, HashSet};

pub(crate) struct MaterializedThreadSnapshot {
    pub transcript_snapshot: TranscriptSnapshot,
    pub projection: SessionProjectionSnapshot,
}

pub(crate) fn materialize_provider_owned_thread_snapshot(
    session_id: &str,
    agent_id: Option<CanonicalAgentId>,
    transcript_revision: i64,
    snapshot: &ProviderOwnedSessionSnapshot,
) -> MaterializedThreadSnapshot {
    let mut transcript_snapshot = if snapshot.canonical_transcript_events.is_empty() {
        TranscriptSnapshot::from_stored_entries(
            transcript_revision,
            &snapshot.thread_snapshot.entries,
        )
    } else {
        TranscriptSnapshot::from_canonical_events(
            transcript_revision,
            &snapshot.canonical_transcript_events,
        )
    };
    let mut projection = ProjectionRegistry::project_thread_snapshot(
        session_id,
        agent_id,
        &snapshot.thread_snapshot,
    );
    if !snapshot.canonical_tool_call_updates.is_empty() {
        let registry = ProjectionRegistry::new();
        registry.restore_session_projection(projection);
        for update in &snapshot.canonical_tool_call_updates {
            registry.apply_session_update(
                session_id,
                &SessionUpdate::ToolCallUpdate {
                    update: update.clone(),
                    session_id: Some(session_id.to_string()),
                },
            );
        }
        projection = registry.session_projection(session_id);
    }
    if snapshot.canonical_transcript_events.is_empty() {
        transcript_snapshot = drop_unlinked_duplicate_replay_tool_rows(
            transcript_snapshot,
            &snapshot.thread_snapshot,
            &projection.operations,
        );
    }
    projection.operations =
        relink_operations_to_transcript(&transcript_snapshot, projection.operations);
    projection.operations =
        ensure_transcript_tool_operations(session_id, &transcript_snapshot, projection.operations);
    projection = close_historical_active_projection(
        projection,
        !transcript_snapshot.entries.is_empty() || !snapshot.thread_snapshot.entries.is_empty(),
    );

    MaterializedThreadSnapshot {
        transcript_snapshot,
        projection,
    }
}

fn close_historical_active_projection(
    mut projection: SessionProjectionSnapshot,
    has_history: bool,
) -> SessionProjectionSnapshot {
    let mut had_active_state = false;

    projection.operations = projection
        .operations
        .into_iter()
        .map(|mut operation| {
            if !is_terminal_operation_state(&operation.operation_state) {
                operation.operation_state = OperationState::Cancelled;
                had_active_state = true;
            }
            operation
        })
        .collect();

    projection.interactions = projection
        .interactions
        .into_iter()
        .map(|mut interaction| {
            if interaction.state == InteractionState::Pending {
                interaction.state = InteractionState::Unresolved;
                had_active_state = true;
            }
            interaction
        })
        .collect();

    if let Some(mut session) = projection.session {
        if session.active_turn_failure.is_some() {
            session.turn_state = SessionTurnState::Failed;
        } else if session.turn_state == SessionTurnState::Running || had_active_state {
            session.turn_state = if has_history {
                SessionTurnState::Completed
            } else {
                SessionTurnState::Idle
            };
            session.active_tool_call_ids.clear();
        }
        projection.session = Some(session);
    }

    projection
}

pub(crate) fn ensure_transcript_tool_operations(
    session_id: &str,
    transcript_snapshot: &TranscriptSnapshot,
    operations: Vec<OperationSnapshot>,
) -> Vec<OperationSnapshot> {
    let linked_entry_ids = operations
        .iter()
        .filter_map(|operation| match &operation.source_link {
            OperationSourceLink::TranscriptLinked { entry_id } => Some(entry_id.clone()),
            OperationSourceLink::Synthetic { .. } | OperationSourceLink::Degraded { .. } => None,
        })
        .collect::<HashSet<_>>();

    for entry in transcript_snapshot
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
    {
        if !linked_entry_ids.contains(&entry.entry_id) {
            tracing::error!(
                session_id = %session_id,
                entry_id = %entry.entry_id,
                "unmatched transcript tool entry after relinking — missing provider evidence",
            );
        }
    }

    operations
}

pub(crate) fn relink_operations_to_transcript(
    transcript: &TranscriptSnapshot,
    mut operations: Vec<OperationSnapshot>,
) -> Vec<OperationSnapshot> {
    let tool_entry_map: HashMap<String, String> = transcript
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
        .filter_map(|entry| {
            tool_call_id_from_authority_entry_id(&entry.entry_id)
                .map(|tc_id| (tc_id, entry.entry_id.clone()))
        })
        .collect();

    if tool_entry_map.is_empty() {
        return operations;
    }

    for op in &mut operations {
        if let OperationSourceLink::TranscriptLinked { entry_id } = &mut op.source_link {
            if let Some(canonical_entry_id) = tool_entry_map.get(&op.tool_call_id) {
                *entry_id = canonical_entry_id.clone();
            }
        }
    }

    operations
}

fn drop_unlinked_duplicate_replay_tool_rows(
    transcript_snapshot: TranscriptSnapshot,
    thread_snapshot: &SessionThreadSnapshot,
    operations: &[OperationSnapshot],
) -> TranscriptSnapshot {
    let linked_entry_ids = operations
        .iter()
        .filter_map(|operation| match &operation.source_link {
            OperationSourceLink::TranscriptLinked { entry_id } => Some(entry_id.clone()),
            OperationSourceLink::Synthetic { .. } | OperationSourceLink::Degraded { .. } => None,
        })
        .collect::<HashSet<_>>();
    let mut seen_tool_call_ids = HashSet::new();
    let mut duplicate_unlinked_entry_ids = HashSet::new();

    for stored_entry in &thread_snapshot.entries {
        let StoredEntry::ToolCall { id, message, .. } = stored_entry else {
            continue;
        };
        if should_skip_historical_question_tool(message) {
            continue;
        }

        let entry_id = normalize_tool_call_id(id);
        let tool_call_id = normalize_tool_call_id(&message.id);
        if seen_tool_call_ids.insert(tool_call_id) {
            continue;
        }
        if !linked_entry_ids.contains(&entry_id) {
            duplicate_unlinked_entry_ids.insert(entry_id);
        }
    }

    if duplicate_unlinked_entry_ids.is_empty() {
        return transcript_snapshot;
    }

    TranscriptSnapshot {
        revision: transcript_snapshot.revision,
        entries: transcript_snapshot
            .entries
            .into_iter()
            .filter(|entry| {
                entry.role != TranscriptEntryRole::Tool
                    || !duplicate_unlinked_entry_ids.contains(&entry.entry_id)
            })
            .collect(),
    }
}

fn should_skip_historical_question_tool(tool_call: &ToolCallData) -> bool {
    matches!(tool_call.kind, Some(ToolKind::Question)) && tool_call.question_answer.is_none()
}

fn is_terminal_operation_state(state: &OperationState) -> bool {
    matches!(
        state,
        OperationState::Completed
            | OperationState::Failed
            | OperationState::Cancelled
            | OperationState::Degraded
    )
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_transcript_tool_operations, materialize_provider_owned_thread_snapshot,
        relink_operations_to_transcript,
    };
    use crate::acp::parsers::AgentType;
    use crate::acp::projections::{
        OperationDegradationCode, OperationSnapshot, OperationSourceLink, OperationState,
        SessionTurnState,
    };
    use crate::acp::session_thread_snapshot::{
        ProviderOwnedSessionSnapshot, SessionThreadSnapshot,
    };
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use crate::acp::transcript_projection::{
        CanonicalTranscriptEvent, CanonicalTranscriptEventKind, TranscriptEntry,
        TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot, derive_tool_entry_id,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::session_jsonl::types::{
        StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    };
    use serde_json::Value;

    fn tool_transcript(entry_id: &str) -> TranscriptSnapshot {
        TranscriptSnapshot {
            revision: 1,
            entries: vec![TranscriptEntry {
                entry_id: entry_id.to_string(),
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{entry_id}:tool"),
                    text: "Run".to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        }
    }

    fn linked_operation(session_id: &str, entry_id: &str) -> OperationSnapshot {
        OperationSnapshot {
            id: format!("op:{entry_id}"),
            session_id: session_id.to_string(),
            tool_call_id: entry_id.to_string(),
            name: "Run".to_string(),
            kind: None,
            provider_status: ToolCallStatus::Completed,
            title: Some("Run".to_string()),
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
            operation_state: OperationState::Completed,
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

    fn replayed_read_tool_entry(
        entry_id: &str,
        tool_call_id: &str,
        title: Option<&str>,
    ) -> StoredEntry {
        read_tool_entry(entry_id, tool_call_id, title, ToolCallStatus::Completed)
    }

    fn read_tool_entry(
        entry_id: &str,
        tool_call_id: &str,
        title: Option<&str>,
        status: ToolCallStatus,
    ) -> StoredEntry {
        StoredEntry::ToolCall {
            id: entry_id.to_string(),
            message: ToolCallData {
                id: tool_call_id.to_string(),
                name: "Read".to_string(),
                arguments: ToolArguments::Read {
                    file_path: Some("/provider/README.md".to_string()),
                    source_context: None,
                },
                diagnostic_input: None,
                status,
                result: None,
                kind: Some(ToolKind::Read),
                title: title.map(str::to_string),
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
    fn ensure_returns_operations_unchanged_for_unlinked_transcript_tool_row() {
        // After relinking, any unmatched row is missing provider evidence — ensure is a tripwire
        // assertion, not a degraded-op factory. Operations pass through unchanged.
        let operations =
            ensure_transcript_tool_operations("session-1", &tool_transcript("tool-missing"), vec![
                linked_operation("session-1", "other-tool"),
            ]);

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].tool_call_id, "other-tool");
    }

    #[test]
    fn keeps_existing_source_linked_operation_for_transcript_tool_row() {
        let existing_operation = linked_operation("session-1", "tool-linked");
        let operations = ensure_transcript_tool_operations(
            "session-1",
            &tool_transcript("tool-linked"),
            vec![existing_operation.clone()],
        );

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].id, existing_operation.id);
        assert_eq!(operations[0].operation_state, OperationState::Completed);
    }

    // -----------------------------------------------------------------------
    // relink_operations_to_transcript
    // -----------------------------------------------------------------------

    fn acepe_tool_transcript(tool_call_id: &str) -> TranscriptSnapshot {
        TranscriptSnapshot {
            revision: 1,
            entries: vec![TranscriptEntry {
                entry_id: derive_tool_entry_id("session-start", tool_call_id),
                role: TranscriptEntryRole::Tool,
                segments: vec![],
                attempt_id: None,
                timestamp_ms: None,
            }],
        }
    }

    fn synthetic_operation(session_id: &str, tool_call_id: &str) -> OperationSnapshot {
        let mut op = linked_operation(session_id, tool_call_id);
        op.source_link = OperationSourceLink::Synthetic {
            reason: "test".to_string(),
        };
        op
    }

    #[test]
    fn relink_patches_transcript_linked_entry_id_to_acepe_format() {
        let transcript = acepe_tool_transcript("toolu_01abc");
        let op = linked_operation("s1", "toolu_01abc");
        let result = relink_operations_to_transcript(&transcript, vec![op]);

        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: derive_tool_entry_id("session-start", "toolu_01abc"),
            }
        );
    }

    #[test]
    fn relink_patches_all_matching_operations() {
        let mut transcript = acepe_tool_transcript("toolu_01abc");
        transcript.entries.push(TranscriptEntry {
            entry_id: derive_tool_entry_id("session-start", "toolu_02def"),
            role: TranscriptEntryRole::Tool,
            segments: vec![],
            attempt_id: None,
            timestamp_ms: None,
        });
        let ops = vec![
            linked_operation("s1", "toolu_01abc"),
            linked_operation("s1", "toolu_02def"),
        ];
        let result = relink_operations_to_transcript(&transcript, ops);

        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0].source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: derive_tool_entry_id("session-start", "toolu_01abc"),
            }
        );
        assert_eq!(
            result[1].source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: derive_tool_entry_id("session-start", "toolu_02def"),
            }
        );
    }

    #[test]
    fn relink_does_not_touch_synthetic_operations() {
        let transcript = acepe_tool_transcript("toolu_01abc");
        let op = synthetic_operation("s1", "toolu_01abc");
        let original_link = op.source_link.clone();
        let result = relink_operations_to_transcript(&transcript, vec![op]);

        assert_eq!(result[0].source_link, original_link);
    }

    #[test]
    fn relink_leaves_unmatched_operation_unchanged() {
        let transcript = acepe_tool_transcript("toolu_other");
        let op = linked_operation("s1", "toolu_01abc");
        let original_link = op.source_link.clone();
        let result = relink_operations_to_transcript(&transcript, vec![op]);

        assert_eq!(result[0].source_link, original_link);
    }

    #[test]
    fn relink_returns_operations_unchanged_when_transcript_empty() {
        let empty_transcript = TranscriptSnapshot {
            revision: 1,
            entries: vec![],
        };
        let op = linked_operation("s1", "toolu_01abc");
        let original_link = op.source_link.clone();
        let result = relink_operations_to_transcript(&empty_transcript, vec![op]);

        assert_eq!(result[0].source_link, original_link);
    }

    #[test]
    fn relink_returns_empty_vec_for_empty_operations() {
        let transcript = acepe_tool_transcript("toolu_01abc");
        let result = relink_operations_to_transcript(&transcript, vec![]);

        assert!(result.is_empty());
    }

    #[test]
    fn relink_handles_control_char_tool_call_id() {
        // tool_call_id with a control char normalizes to percent-encoded form on both sides
        let raw_id = "toolu\n01abc";
        let normalized_id = "toolu%0A01abc";
        let transcript = acepe_tool_transcript(raw_id);
        // linked_operation sets tool_call_id = normalized_id (mirrors operation ingress normalisation)
        let op = linked_operation("s1", normalized_id);
        let result = relink_operations_to_transcript(&transcript, vec![op]);

        assert_eq!(
            result[0].source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: derive_tool_entry_id("session-start", raw_id),
            }
        );
    }

    #[test]
    fn relink_is_idempotent() {
        let transcript = acepe_tool_transcript("toolu_01abc");
        let op = linked_operation("s1", "toolu_01abc");
        let once = relink_operations_to_transcript(&transcript, vec![op]);
        let twice = relink_operations_to_transcript(&transcript, once.clone());

        assert_eq!(once[0].source_link, twice[0].source_link);
    }

    #[test]
    fn provider_owned_materialization_drops_unlinked_duplicate_replay_tool_rows() {
        let provider_snapshot =
            ProviderOwnedSessionSnapshot::from_thread_snapshot(SessionThreadSnapshot {
                entries: vec![
                    replayed_read_tool_entry("provider-read", "provider-read", Some("Read file")),
                    replayed_read_tool_entry("provider-read-sparse-entry", "provider-read", None),
                ],
                title: "Provider title".to_string(),
                created_at: "2026-04-23T00:00:00Z".to_string(),
                current_mode_id: None,
            });

        let materialized = materialize_provider_owned_thread_snapshot(
            "session-1",
            Some(CanonicalAgentId::Copilot),
            11,
            &provider_snapshot,
        );

        let expected_entry_id = derive_tool_entry_id("session-start", "provider-read");
        assert_eq!(
            materialized
                .transcript_snapshot
                .entries
                .iter()
                .map(|entry| entry.entry_id.as_str())
                .collect::<Vec<_>>(),
            vec![expected_entry_id.as_str()]
        );
        assert_eq!(materialized.projection.operations.len(), 1);
        let operation = &materialized.projection.operations[0];
        assert_eq!(operation.tool_call_id, "provider-read");
        assert_eq!(operation.title.as_deref(), Some("Read file"));
        assert_eq!(operation.kind, Some(ToolKind::Read));
        assert_eq!(operation.operation_state, OperationState::Completed);
        assert_eq!(operation.degradation_reason, None);
        assert_eq!(
            operation.source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: expected_entry_id,
            }
        );
    }

    #[test]
    fn provider_owned_materialization_closes_historical_active_tool_rows() {
        let provider_snapshot =
            ProviderOwnedSessionSnapshot::from_thread_snapshot(SessionThreadSnapshot {
                entries: vec![read_tool_entry(
                    "provider-read",
                    "provider-read",
                    Some("Read file"),
                    ToolCallStatus::InProgress,
                )],
                title: "Provider title".to_string(),
                created_at: "2026-05-20T00:00:00Z".to_string(),
                current_mode_id: None,
            });

        let materialized =
            materialize_provider_owned_thread_snapshot("session-1", None, 12, &provider_snapshot);

        let session = materialized.projection.session.expect("session projection");
        assert_eq!(session.turn_state, SessionTurnState::Completed);
        assert!(session.active_tool_call_ids.is_empty());
        assert_eq!(materialized.projection.operations.len(), 1);
        assert_eq!(
            materialized.projection.operations[0].operation_state,
            OperationState::Cancelled
        );
    }

    #[test]
    fn provider_owned_materialization_closes_historical_active_canonical_updates() {
        let mut provider_snapshot =
            ProviderOwnedSessionSnapshot::from_thread_snapshot(SessionThreadSnapshot {
                entries: vec![read_tool_entry(
                    "provider-read",
                    "provider-read",
                    Some("Read file"),
                    ToolCallStatus::InProgress,
                )],
                title: "Provider title".to_string(),
                created_at: "2026-05-20T00:00:00Z".to_string(),
                current_mode_id: None,
            });
        provider_snapshot.set_canonical_tool_call_updates(vec![
            crate::acp::session_update::ToolCallUpdateData {
                tool_call_id: "provider-read".to_string(),
                status: Some(ToolCallStatus::InProgress),
                result: None,
                content: None,
                raw_output: None,
                title: Some("Reading file".to_string()),
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: None,
                failure_reason: None,
            },
        ]);

        let materialized =
            materialize_provider_owned_thread_snapshot("session-1", None, 13, &provider_snapshot);

        let session = materialized.projection.session.expect("session projection");
        assert_eq!(session.turn_state, SessionTurnState::Completed);
        assert!(session.active_tool_call_ids.is_empty());
        assert_eq!(
            materialized.projection.operations[0].operation_state,
            OperationState::Cancelled
        );
        assert_eq!(
            materialized.projection.operations[0].provider_status,
            ToolCallStatus::InProgress
        );
    }

    #[test]
    fn provider_owned_materialization_uses_canonical_events_before_stored_entries() {
        let provider_snapshot = ProviderOwnedSessionSnapshot::with_canonical_transcript_events(
            SessionThreadSnapshot {
                entries: vec![StoredEntry::Assistant {
                    id: "legacy-provider-id".to_string(),
                    message: StoredAssistantMessage {
                        chunks: vec![StoredAssistantChunk {
                            chunk_type: "message".to_string(),
                            block: StoredContentBlock {
                                block_type: "text".to_string(),
                                text: Some("canonical answer".to_string()),
                            },
                        }],
                        model: None,
                        display_model: None,
                        received_at: Some("2026-05-18T00:00:00Z".to_string()),
                    },
                    timestamp: Some("2026-05-18T00:00:00Z".to_string()),
                }],
                title: "Session".to_string(),
                created_at: "2026-05-18T00:00:00Z".to_string(),
                current_mode_id: None,
            },
            vec![CanonicalTranscriptEvent {
                transcript_seq: 0,
                source: AgentType::ClaudeCode,
                provider_row_id: "row-1".to_string(),
                provider_msg_id: Some("legacy-provider-id".to_string()),
                request_id: Some("request-1".to_string()),
                block_index: 0,
                display_id: "assistant-display-1".to_string(),
                timestamp: "2026-05-18T00:00:00Z".to_string(),
                model: None,
                kind: CanonicalTranscriptEventKind::AssistantText {
                    text: "canonical answer".to_string(),
                },
            }],
        );

        let materialized =
            materialize_provider_owned_thread_snapshot("session-1", None, 7, &provider_snapshot);

        assert_eq!(materialized.transcript_snapshot.revision, 7);
        assert_eq!(materialized.transcript_snapshot.entries.len(), 1);
        // Entry id uses canonical acepe:: format, not the provider display_id
        assert_eq!(
            materialized.transcript_snapshot.entries[0].entry_id,
            "acepe::entry::session-start::assistant::."
        );
    }
}
