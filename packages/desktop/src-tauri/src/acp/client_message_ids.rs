use crate::acp::parsers::AgentType;
use crate::acp::session_update::SessionUpdate;
use crate::acp::types::ContentBlock;
use std::collections::HashMap;
use uuid::Uuid;

/// Normalize message IDs and deduplicate replayed assistant messages.
///
/// Returns `None` when a chunk should be dropped (e.g., Codex replaying
/// a previous assistant response at the start of a new turn).
pub(crate) fn normalize_message_id(
    _agent_type: AgentType,
    update: SessionUpdate,
    tracker: &mut HashMap<String, String>,
    assistant_text_tracker: &mut HashMap<String, String>,
) -> Option<SessionUpdate> {
    match update {
        SessionUpdate::UserMessageChunk { chunk, session_id } => {
            if let Some(session_id) = session_id.as_ref() {
                tracker.remove(session_id);
            }
            Some(SessionUpdate::UserMessageChunk { chunk, session_id })
        }
        SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            session_id,
        } => {
            // Dedup: Codex replays the full previous assistant response as a single
            // chunk at the start of each turn. Drop it if it exactly matches.
            if let Some(sid) = session_id.as_ref() {
                if let Some(last_text) = assistant_text_tracker.get(sid) {
                    if let ContentBlock::Text { ref text } = chunk.content {
                        if text == last_text {
                            return None;
                        }
                    }
                }
                // Track the latest assistant chunk text for future dedup.
                if let ContentBlock::Text { ref text } = chunk.content {
                    assistant_text_tracker.insert(sid.clone(), text.clone());
                }
            }

            let resolved_message_id = resolve_message_id(tracker, session_id.as_ref(), message_id);
            Some(SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id: resolved_message_id,
                session_id,
            })
        }
        SessionUpdate::AgentThoughtChunk {
            chunk,
            part_id,
            message_id,
            session_id,
        } => {
            let resolved_message_id = resolve_message_id(tracker, session_id.as_ref(), message_id);
            Some(SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id: resolved_message_id,
                session_id,
            })
        }
        SessionUpdate::TurnComplete {
            session_id,
            turn_id,
        } => {
            if let Some(session_id) = session_id.as_ref() {
                tracker.remove(session_id);
                assistant_text_tracker.remove(session_id);
            }
            Some(SessionUpdate::TurnComplete {
                session_id,
                turn_id,
            })
        }
        _ => Some(update),
    }
}

fn resolve_message_id(
    tracker: &mut HashMap<String, String>,
    session_id: Option<&String>,
    message_id: Option<String>,
) -> Option<String> {
    let session_id = session_id?;
    if let Some(existing) = message_id {
        tracker.insert(session_id.clone(), existing.clone());
        return Some(existing);
    }

    let entry = tracker
        .entry(session_id.clone())
        .or_insert_with(|| format!("normalized-msg-{}", Uuid::new_v4()));
    Some(entry.clone())
}

#[cfg(test)]
mod tests {
    use super::normalize_message_id;
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::{ContentChunk, SessionUpdate};
    use crate::acp::types::ContentBlock;
    use std::collections::HashMap;

    fn thought_chunk(session_id: &str) -> SessionUpdate {
        SessionUpdate::AgentThoughtChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Thinking".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some(session_id.to_string()),
        }
    }

    fn message_chunk(session_id: &str) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some(session_id.to_string()),
        }
    }

    fn message_chunk_with_text(session_id: &str, text: &str) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: text.to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some(session_id.to_string()),
        }
    }

    fn extract_message_id(update: &SessionUpdate) -> Option<String> {
        match update {
            SessionUpdate::AgentMessageChunk { message_id, .. } => message_id.clone(),
            SessionUpdate::AgentThoughtChunk { message_id, .. } => message_id.clone(),
            _ => None,
        }
    }

    #[test]
    fn assigns_message_id_for_codex_when_missing() {
        let mut tracker = HashMap::new();
        let mut assistant_tracker = HashMap::new();
        let update = thought_chunk("session-1");

        let normalized = normalize_message_id(
            AgentType::Codex,
            update,
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let message_id = extract_message_id(&normalized);

        assert!(message_id.is_some());
        assert_eq!(tracker.get("session-1"), message_id.as_ref());
    }

    #[test]
    fn reuses_message_id_until_turn_complete() {
        let mut tracker = HashMap::new();
        let mut assistant_tracker = HashMap::new();
        let first = normalize_message_id(
            AgentType::Codex,
            thought_chunk("session-1"),
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let first_id = extract_message_id(&first).expect("message id");

        let second = normalize_message_id(
            AgentType::Codex,
            message_chunk("session-1"),
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let second_id = extract_message_id(&second).expect("message id");

        assert_eq!(first_id, second_id);
    }

    #[test]
    fn clears_message_id_on_turn_complete() {
        let mut tracker = HashMap::new();
        let mut assistant_tracker = HashMap::new();
        let first = normalize_message_id(
            AgentType::Codex,
            thought_chunk("session-1"),
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let first_id = extract_message_id(&first).expect("message id");

        let cleared = normalize_message_id(
            AgentType::Codex,
            SessionUpdate::TurnComplete {
                session_id: Some("session-1".to_string()),
                turn_id: None,
            },
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");

        assert!(matches!(cleared, SessionUpdate::TurnComplete { .. }));
        assert!(!tracker.contains_key("session-1"));

        let next = normalize_message_id(
            AgentType::Codex,
            thought_chunk("session-1"),
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let next_id = extract_message_id(&next).expect("message id");

        assert_ne!(first_id, next_id);
    }

    #[test]
    fn clears_message_id_on_user_message_chunk_boundary() {
        let mut tracker = HashMap::new();
        let mut assistant_tracker = HashMap::new();
        let first = normalize_message_id(
            AgentType::Codex,
            thought_chunk("session-1"),
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let first_id = extract_message_id(&first).expect("message id");

        let user_boundary = normalize_message_id(
            AgentType::Codex,
            SessionUpdate::UserMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "new prompt".to_string(),
                    },
                    aggregation_hint: None,
                },
                session_id: Some("session-1".to_string()),
            },
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");

        assert!(matches!(
            user_boundary,
            SessionUpdate::UserMessageChunk { .. }
        ));
        assert!(!tracker.contains_key("session-1"));

        let second = normalize_message_id(
            AgentType::Codex,
            thought_chunk("session-1"),
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let second_id = extract_message_id(&second).expect("message id");

        assert_ne!(first_id, second_id);
    }

    #[test]
    fn normalizes_message_ids_for_all_agent_types() {
        let mut tracker = HashMap::new();
        let mut assistant_tracker = HashMap::new();

        let first = normalize_message_id(
            AgentType::ClaudeCode,
            thought_chunk("session-1"),
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let first_id = extract_message_id(&first).expect("message id should exist");

        let second = normalize_message_id(
            AgentType::ClaudeCode,
            message_chunk("session-1"),
            &mut tracker,
            &mut assistant_tracker,
        )
        .expect("should not be dropped");
        let second_id = extract_message_id(&second).expect("message id should exist");

        assert_eq!(first_id, second_id);
    }

    #[test]
    fn drops_replayed_assistant_message_with_same_text() {
        let mut tracker = HashMap::new();
        let mut assistant_tracker = HashMap::new();
        let session = "session-codex";

        // Turn 1: assistant sends full response
        let original = normalize_message_id(
            AgentType::Codex,
            message_chunk_with_text(session, "Yes, if you attach the screenshot here."),
            &mut tracker,
            &mut assistant_tracker,
        );
        assert!(original.is_some(), "original message should pass through");

        // Turn 2: Codex replays user message, then replays assistant message
        normalize_message_id(
            AgentType::Codex,
            SessionUpdate::UserMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "new prompt".to_string(),
                    },
                    aggregation_hint: None,
                },
                session_id: Some(session.to_string()),
            },
            &mut tracker,
            &mut assistant_tracker,
        );

        // Replay of the same assistant text → should be dropped
        let replay = normalize_message_id(
            AgentType::Codex,
            message_chunk_with_text(session, "Yes, if you attach the screenshot here."),
            &mut tracker,
            &mut assistant_tracker,
        );
        assert!(
            replay.is_none(),
            "replayed assistant message should be dropped"
        );

        // New content → should pass through
        let new_content = normalize_message_id(
            AgentType::Codex,
            message_chunk_with_text(session, "I'm checking the most recent file."),
            &mut tracker,
            &mut assistant_tracker,
        );
        assert!(new_content.is_some(), "new content should pass through");
    }

    #[test]
    fn does_not_drop_different_assistant_text() {
        let mut tracker = HashMap::new();
        let mut assistant_tracker = HashMap::new();
        let session = "session-no-dedup";

        let first = normalize_message_id(
            AgentType::Codex,
            message_chunk_with_text(session, "First response"),
            &mut tracker,
            &mut assistant_tracker,
        );
        assert!(first.is_some());

        // Different text → should NOT be dropped
        let second = normalize_message_id(
            AgentType::Codex,
            message_chunk_with_text(session, "Second response"),
            &mut tracker,
            &mut assistant_tracker,
        );
        assert!(second.is_some());
    }

    #[test]
    fn clears_assistant_text_tracker_on_turn_complete() {
        let mut tracker = HashMap::new();
        let mut assistant_tracker = HashMap::new();
        let session = "session-clear";

        // Send assistant message
        normalize_message_id(
            AgentType::Codex,
            message_chunk_with_text(session, "Response text"),
            &mut tracker,
            &mut assistant_tracker,
        );
        assert!(assistant_tracker.contains_key(session));

        // Turn complete should clear the tracker
        normalize_message_id(
            AgentType::Codex,
            SessionUpdate::TurnComplete {
                session_id: Some(session.to_string()),
                turn_id: None,
            },
            &mut tracker,
            &mut assistant_tracker,
        );
        assert!(!assistant_tracker.contains_key(session));

        // Same text after turn complete should pass (not a replay)
        let after_clear = normalize_message_id(
            AgentType::Codex,
            message_chunk_with_text(session, "Response text"),
            &mut tracker,
            &mut assistant_tracker,
        );
        assert!(
            after_clear.is_some(),
            "same text after turn complete should pass"
        );
    }
}
