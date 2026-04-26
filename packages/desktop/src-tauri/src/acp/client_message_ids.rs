//! Stable message-id assignment for streaming assistant chunks.
//!
//! Pure, agent-agnostic: takes a `SessionUpdate` in, assigns a stable
//! `message_id` for the current turn when one is missing, and clears the
//! per-session id at turn boundaries (`UserMessageChunk`, `TurnComplete`).
//!
//! Provider-specific quirks (e.g. transport-level replay handling) MUST live
//! at the provider edge (`parsers/`, `providers/`, `client/<provider>_*`),
//! never here. An architectural guard test in `client/tests.rs` enforces
//! this boundary.

use crate::acp::session_update::SessionUpdate;
use std::collections::HashMap;
use uuid::Uuid;

/// Assign a stable message id for the current turn.
///
/// - On `UserMessageChunk` and `TurnComplete`, clears the per-session id so
///   the next assistant chunk starts a fresh turn.
/// - On `AgentMessageChunk` / `AgentThoughtChunk`, reuses the cached id (or
///   generates one) so all chunks within a turn share an id.
/// - All other variants pass through untouched.
pub(crate) fn normalize_message_id(
    update: SessionUpdate,
    tracker: &mut HashMap<String, String>,
) -> SessionUpdate {
    match update {
        SessionUpdate::UserMessageChunk { chunk, session_id } => {
            if let Some(session_id) = session_id.as_ref() {
                tracker.remove(session_id);
            }
            SessionUpdate::UserMessageChunk { chunk, session_id }
        }
        SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            session_id,
        } => {
            let resolved_message_id = resolve_message_id(tracker, session_id.as_ref(), message_id);
            SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id: resolved_message_id,
                session_id,
            }
        }
        SessionUpdate::AgentThoughtChunk {
            chunk,
            part_id,
            message_id,
            session_id,
        } => {
            let resolved_message_id = resolve_message_id(tracker, session_id.as_ref(), message_id);
            SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id: resolved_message_id,
                session_id,
            }
        }
        SessionUpdate::TurnComplete {
            session_id,
            turn_id,
        } => {
            if let Some(session_id) = session_id.as_ref() {
                tracker.remove(session_id);
            }
            SessionUpdate::TurnComplete {
                session_id,
                turn_id,
            }
        }
        other => other,
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
    fn assigns_message_id_when_missing() {
        let mut tracker = HashMap::new();
        let normalized = normalize_message_id(thought_chunk("session-1"), &mut tracker);
        let message_id = extract_message_id(&normalized);

        assert!(message_id.is_some());
        assert_eq!(tracker.get("session-1"), message_id.as_ref());
    }

    #[test]
    fn reuses_message_id_until_turn_complete() {
        let mut tracker = HashMap::new();
        let first = normalize_message_id(thought_chunk("session-1"), &mut tracker);
        let first_id = extract_message_id(&first).expect("message id");

        let second = normalize_message_id(message_chunk("session-1"), &mut tracker);
        let second_id = extract_message_id(&second).expect("message id");

        assert_eq!(first_id, second_id);
    }

    #[test]
    fn clears_message_id_on_turn_complete() {
        let mut tracker = HashMap::new();
        let first = normalize_message_id(thought_chunk("session-1"), &mut tracker);
        let first_id = extract_message_id(&first).expect("message id");

        let cleared = normalize_message_id(
            SessionUpdate::TurnComplete {
                session_id: Some("session-1".to_string()),
                turn_id: None,
            },
            &mut tracker,
        );

        assert!(matches!(cleared, SessionUpdate::TurnComplete { .. }));
        assert!(!tracker.contains_key("session-1"));

        let next = normalize_message_id(thought_chunk("session-1"), &mut tracker);
        let next_id = extract_message_id(&next).expect("message id");

        assert_ne!(first_id, next_id);
    }

    #[test]
    fn clears_message_id_on_user_message_chunk_boundary() {
        let mut tracker = HashMap::new();
        let first = normalize_message_id(thought_chunk("session-1"), &mut tracker);
        let first_id = extract_message_id(&first).expect("message id");

        let user_boundary = normalize_message_id(
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
        );

        assert!(matches!(
            user_boundary,
            SessionUpdate::UserMessageChunk { .. }
        ));
        assert!(!tracker.contains_key("session-1"));

        let second = normalize_message_id(thought_chunk("session-1"), &mut tracker);
        let second_id = extract_message_id(&second).expect("message id");

        assert_ne!(first_id, second_id);
    }

    /// Regression: identical assistant text across turns must NOT be dropped.
    /// The previous implementation deduped on text equality, which broke
    /// Cursor and Copilot whenever the assistant repeated itself
    /// (e.g. answering "ok" twice). Provider-specific replay handling, if
    /// ever needed, must live at the provider edge — not here.
    #[test]
    fn does_not_drop_repeated_assistant_text_across_turns() {
        let mut tracker = HashMap::new();
        let session = "session-repeat";

        let first = normalize_message_id(message_chunk_with_text(session, "ok"), &mut tracker);
        assert!(matches!(first, SessionUpdate::AgentMessageChunk { .. }));

        // Turn boundary (UserMessageChunk or TurnComplete).
        normalize_message_id(
            SessionUpdate::TurnComplete {
                session_id: Some(session.to_string()),
                turn_id: None,
            },
            &mut tracker,
        );

        // Identical text in turn 2 must pass through.
        let second = normalize_message_id(message_chunk_with_text(session, "ok"), &mut tracker);
        assert!(
            matches!(second, SessionUpdate::AgentMessageChunk { .. }),
            "identical text in a new turn must not be dropped by shared id normalization"
        );
    }
}
