use crate::acp::projections::{
    InteractionSnapshot, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, SessionGraphActivityKind, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_projection::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActiveStreamingTailContentKind {
    Thought,
    Message,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveStreamingTail {
    pub row_id: String,
    pub content_kind: ActiveStreamingTailContentKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateGraph {
    pub requested_session_id: String,
    pub canonical_session_id: String,
    pub is_alias: bool,
    pub agent_id: CanonicalAgentId,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence_id: Option<i32>,
    pub revision: SessionGraphRevision,
    pub transcript_snapshot: TranscriptSnapshot,
    pub operations: Vec<OperationSnapshot>,
    pub interactions: Vec<InteractionSnapshot>,
    pub turn_state: SessionTurnState,
    pub message_count: u64,
    pub active_streaming_tail: Option<ActiveStreamingTail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_terminal_turn_id: Option<String>,
    pub lifecycle: SessionGraphLifecycle,
    pub activity: SessionGraphActivity,
    pub capabilities: SessionGraphCapabilities,
}

fn assistant_tail_content_kind(entry: &TranscriptEntry) -> ActiveStreamingTailContentKind {
    if entry
        .segments
        .iter()
        .any(|segment| matches!(segment, TranscriptSegment::Text { .. }))
    {
        return ActiveStreamingTailContentKind::Message;
    }

    ActiveStreamingTailContentKind::Thought
}

fn find_latest_assistant_entry_after_latest_user(
    entries: &[TranscriptEntry],
) -> Option<&TranscriptEntry> {
    for entry in entries.iter().rev() {
        if entry.role == TranscriptEntryRole::User {
            return None;
        }
        if entry.role == TranscriptEntryRole::Assistant {
            return Some(entry);
        }
    }

    None
}

pub fn select_active_streaming_tail(
    turn_state: &SessionTurnState,
    activity: &SessionGraphActivity,
    transcript_snapshot: &TranscriptSnapshot,
) -> Option<ActiveStreamingTail> {
    if !matches!(turn_state, SessionTurnState::Running) {
        return None;
    }

    if activity.kind != SessionGraphActivityKind::AwaitingModel {
        return None;
    }

    let entries = transcript_snapshot.entries.as_slice();
    if let Some(entry) = entries.last() {
        if entry.role == TranscriptEntryRole::Assistant {
            return Some(ActiveStreamingTail {
                row_id: entry.entry_id.clone(),
                content_kind: assistant_tail_content_kind(entry),
            });
        }
    }

    let entry = find_latest_assistant_entry_after_latest_user(entries)?;
    Some(ActiveStreamingTail {
        row_id: entry.entry_id.clone(),
        content_kind: assistant_tail_content_kind(entry),
    })
}

pub fn select_awaiting_placeholder(
    turn_state: &SessionTurnState,
    activity: &SessionGraphActivity,
    transcript_snapshot: &TranscriptSnapshot,
) -> bool {
    if !matches!(turn_state, SessionTurnState::Running) {
        return false;
    }

    if activity.kind != SessionGraphActivityKind::AwaitingModel {
        return false;
    }

    find_latest_assistant_entry_after_latest_user(&transcript_snapshot.entries).is_none()
}

#[cfg(test)]
mod tests {
    use super::{
        select_active_streaming_tail, select_awaiting_placeholder, ActiveStreamingTail,
        ActiveStreamingTailContentKind,
    };
    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphActivityKind,
    };
    use crate::acp::transcript_projection::{
        TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
    };

    fn text_entry(entry_id: &str, role: TranscriptEntryRole) -> TranscriptEntry {
        TranscriptEntry {
            entry_id: entry_id.to_string(),
            role,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:text:0"),
                text: "text".to_string(),
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

    #[test]
    fn active_streaming_tail_marks_only_trailing_assistant_while_running() {
        let result = select_active_streaming_tail(
            &SessionTurnState::Running,
            &SessionGraphActivity {
                kind: SessionGraphActivityKind::AwaitingModel,
                active_operation_count: 0,
                active_subagent_count: 0,
                dominant_operation_id: None,
                blocking_interaction_id: None,
            },
            &snapshot(vec![
                text_entry("a1", TranscriptEntryRole::Assistant),
                text_entry("a2", TranscriptEntryRole::Assistant),
            ]),
        );

        assert_eq!(
            result,
            Some(ActiveStreamingTail {
                row_id: "a2".to_string(),
                content_kind: ActiveStreamingTailContentKind::Message,
            })
        );
    }

    #[test]
    fn active_streaming_tail_is_absent_when_tool_is_running_after_assistant() {
        let result = select_active_streaming_tail(
            &SessionTurnState::Running,
            &SessionGraphActivity {
                kind: SessionGraphActivityKind::RunningOperation,
                active_operation_count: 1,
                active_subagent_count: 0,
                dominant_operation_id: Some("op-1".to_string()),
                blocking_interaction_id: None,
            },
            &snapshot(vec![
                text_entry("a1", TranscriptEntryRole::Assistant),
                text_entry("tool-1", TranscriptEntryRole::Tool),
            ]),
        );

        assert_eq!(result, None);
    }

    #[test]
    fn active_streaming_tail_keeps_open_assistant_while_awaiting_more_model_text() {
        let result = select_active_streaming_tail(
            &SessionTurnState::Running,
            &SessionGraphActivity {
                kind: SessionGraphActivityKind::AwaitingModel,
                active_operation_count: 0,
                active_subagent_count: 0,
                dominant_operation_id: None,
                blocking_interaction_id: None,
            },
            &snapshot(vec![
                text_entry("u1", TranscriptEntryRole::User),
                text_entry("a1", TranscriptEntryRole::Assistant),
                text_entry("tool-1", TranscriptEntryRole::Tool),
            ]),
        );

        assert_eq!(
            result,
            Some(ActiveStreamingTail {
                row_id: "a1".to_string(),
                content_kind: ActiveStreamingTailContentKind::Message,
            })
        );
    }

    fn awaiting_activity() -> SessionGraphActivity {
        SessionGraphActivity {
            kind: SessionGraphActivityKind::AwaitingModel,
            active_operation_count: 0,
            active_subagent_count: 0,
            dominant_operation_id: None,
            blocking_interaction_id: None,
        }
    }

    fn running_op_activity() -> SessionGraphActivity {
        SessionGraphActivity {
            kind: SessionGraphActivityKind::RunningOperation,
            active_operation_count: 1,
            active_subagent_count: 0,
            dominant_operation_id: Some("op-1".to_string()),
            blocking_interaction_id: None,
        }
    }

    #[test]
    fn awaiting_placeholder_true_for_running_awaiting_no_assistant_after_user() {
        assert!(select_awaiting_placeholder(
            &SessionTurnState::Running,
            &awaiting_activity(),
            &snapshot(vec![
                text_entry("u1", TranscriptEntryRole::User),
                text_entry("tool-1", TranscriptEntryRole::Tool),
            ]),
        ));
    }

    #[test]
    fn awaiting_placeholder_true_on_first_turn_empty_transcript() {
        assert!(select_awaiting_placeholder(
            &SessionTurnState::Running,
            &awaiting_activity(),
            &snapshot(vec![]),
        ));
    }

    #[test]
    fn awaiting_placeholder_false_when_assistant_exists_after_user() {
        assert!(!select_awaiting_placeholder(
            &SessionTurnState::Running,
            &awaiting_activity(),
            &snapshot(vec![
                text_entry("u1", TranscriptEntryRole::User),
                text_entry("a1", TranscriptEntryRole::Assistant),
            ]),
        ));
    }

    #[test]
    fn awaiting_placeholder_false_when_not_running() {
        assert!(!select_awaiting_placeholder(
            &SessionTurnState::Idle,
            &awaiting_activity(),
            &snapshot(vec![text_entry("u1", TranscriptEntryRole::User)]),
        ));
    }

    #[test]
    fn awaiting_placeholder_false_when_running_operation() {
        assert!(!select_awaiting_placeholder(
            &SessionTurnState::Running,
            &running_op_activity(),
            &snapshot(vec![
                text_entry("u1", TranscriptEntryRole::User),
                text_entry("tool-1", TranscriptEntryRole::Tool),
            ]),
        ));
    }

    #[test]
    fn awaiting_placeholder_transition_false_after_first_assistant_lands() {
        let snapshot_before = snapshot(vec![text_entry("u1", TranscriptEntryRole::User)]);
        assert!(select_awaiting_placeholder(
            &SessionTurnState::Running,
            &awaiting_activity(),
            &snapshot_before,
        ));
        let snapshot_after = snapshot(vec![
            text_entry("u1", TranscriptEntryRole::User),
            text_entry("a1", TranscriptEntryRole::Assistant),
        ]);
        assert!(!select_awaiting_placeholder(
            &SessionTurnState::Running,
            &awaiting_activity(),
            &snapshot_after,
        ));
    }

    #[test]
    fn awaiting_placeholder_tool_result_to_awaiting_gap() {
        let awaiting = awaiting_activity();
        assert!(select_awaiting_placeholder(
            &SessionTurnState::Running,
            &awaiting,
            &snapshot(vec![
                text_entry("u1", TranscriptEntryRole::User),
                text_entry("tool-1", TranscriptEntryRole::Tool),
            ]),
        ));
        assert!(!select_awaiting_placeholder(
            &SessionTurnState::Running,
            &awaiting,
            &snapshot(vec![
                text_entry("u1", TranscriptEntryRole::User),
                text_entry("tool-1", TranscriptEntryRole::Tool),
                text_entry("a2", TranscriptEntryRole::Assistant),
            ]),
        ));
    }
}
