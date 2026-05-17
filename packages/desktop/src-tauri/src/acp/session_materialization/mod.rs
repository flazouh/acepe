use crate::acp::projections::{
    build_canonical_operation_id, OperationDegradationCode, OperationDegradationReason,
    OperationSnapshot, OperationSourceLink, OperationState,
};
use crate::acp::session_update::{ToolArguments, ToolCallStatus};
use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSnapshot};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const MISSING_TOOL_OPERATION_DETAIL: &str =
    "No canonical operation evidence was available for this transcript tool row.";

pub(crate) fn ensure_transcript_tool_operations(
    session_id: &str,
    transcript_snapshot: &TranscriptSnapshot,
    operations: Vec<OperationSnapshot>,
) -> Vec<OperationSnapshot> {
    let mut linked_entry_ids = operations
        .iter()
        .filter_map(|operation| match &operation.source_link {
            OperationSourceLink::TranscriptLinked { entry_id } => Some(entry_id.clone()),
            OperationSourceLink::Synthetic { .. } | OperationSourceLink::Degraded { .. } => None,
        })
        .collect::<HashSet<_>>();
    let mut operation_ids = operations
        .iter()
        .map(|operation| operation.id.clone())
        .collect::<HashSet<_>>();
    let mut completed_operations = operations;

    for entry in transcript_snapshot
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
    {
        if linked_entry_ids.contains(&entry.entry_id) {
            continue;
        }

        let operation = degraded_transcript_tool_operation(session_id, &entry.entry_id);
        if operation_ids.insert(operation.id.clone()) {
            linked_entry_ids.insert(entry.entry_id.clone());
            completed_operations.push(operation);
        }
    }

    completed_operations
}

fn degraded_transcript_tool_operation(session_id: &str, entry_id: &str) -> OperationSnapshot {
    let degradation_reason = OperationDegradationReason {
        code: OperationDegradationCode::MissingEvidence,
        detail: Some(MISSING_TOOL_OPERATION_DETAIL.to_string()),
    };
    let provenance_key = degraded_transcript_tool_provenance_key(entry_id);

    OperationSnapshot {
        id: build_canonical_operation_id(session_id, &provenance_key),
        session_id: session_id.to_string(),
        tool_call_id: entry_id.to_string(),
        name: "Unresolved tool".to_string(),
        kind: None,
        provider_status: ToolCallStatus::Failed,
        title: Some("Unresolved tool".to_string()),
        arguments: ToolArguments::Other { raw: Value::Null },
        progressive_arguments: None,
        result: None,
        command: None,
        normalized_todos: None,
        parent_tool_call_id: None,
        parent_operation_id: None,
        child_tool_call_ids: Vec::new(),
        child_operation_ids: Vec::new(),
        operation_provenance_key: Some(provenance_key),
        operation_state: OperationState::Degraded,
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
        degradation_reason: Some(degradation_reason),
    }
}

fn degraded_transcript_tool_provenance_key(entry_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(entry_id.as_bytes());
    let digest = hasher.finalize();
    format!("degraded-transcript-tool-{}", hex::encode(&digest[..16]))
}

#[cfg(test)]
mod tests {
    use super::ensure_transcript_tool_operations;
    use crate::acp::projections::{
        OperationDegradationCode, OperationSnapshot, OperationSourceLink, OperationState,
    };
    use crate::acp::session_update::{ToolArguments, ToolCallStatus};
    use crate::acp::transcript_projection::{
        TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
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
            arguments: ToolArguments::Other { raw: Value::Null },
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

    #[test]
    fn creates_backend_degraded_operation_for_unlinked_transcript_tool_row() {
        let operations = ensure_transcript_tool_operations(
            "session-1",
            &tool_transcript("tool-missing"),
            Vec::new(),
        );

        assert_eq!(operations.len(), 1);
        let operation = &operations[0];
        assert_eq!(operation.tool_call_id, "tool-missing");
        assert_eq!(operation.operation_state, OperationState::Degraded);
        assert_eq!(
            operation.source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: "tool-missing".to_string()
            }
        );
        assert_eq!(
            operation
                .degradation_reason
                .as_ref()
                .map(|reason| reason.code.clone()),
            Some(OperationDegradationCode::MissingEvidence)
        );
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

    #[test]
    fn degraded_operation_ids_are_stable_for_same_transcript_tool_row() {
        let first = ensure_transcript_tool_operations(
            "session-1",
            &tool_transcript("tool-missing"),
            Vec::new(),
        );
        let second = ensure_transcript_tool_operations(
            "session-1",
            &tool_transcript("tool-missing"),
            Vec::new(),
        );

        assert_eq!(first[0].id, second[0].id);
        assert_eq!(
            first[0].operation_provenance_key,
            second[0].operation_provenance_key
        );
    }
}
