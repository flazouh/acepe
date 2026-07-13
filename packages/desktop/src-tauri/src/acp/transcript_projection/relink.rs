//! Relink operation source links to canonical transcript tool entry ids.

use std::collections::HashMap;

use crate::acp::projections::{OperationSnapshot, OperationSourceLink};
use crate::acp::transcript_projection::{
    tool_call_id_from_authority_entry_id, TranscriptEntryRole, TranscriptSnapshot,
};

/// Patch transcript-linked operation entry ids to match the folded/canonical transcript.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::projections::{OperationSnapshot, OperationSourceLink, OperationState};
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus};
    use crate::acp::transcript_projection::{
        derive_tool_entry_id, TranscriptEntry, TranscriptEntryRole, TranscriptSegment,
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
            computer_payload: None,
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
        let raw_id = "toolu\n01abc";
        let normalized_id = "toolu%0A01abc";
        let transcript = acepe_tool_transcript(raw_id);
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
}
