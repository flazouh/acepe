use crate::acp::session_update::{ContentChunk, SessionUpdate};
use crate::acp::types::ContentBlock;
use dashmap::DashMap;
use std::collections::VecDeque;
use std::sync::LazyLock;

static PENDING_PROMPT_ECHOES: LazyLock<DashMap<String, VecDeque<String>>> =
    LazyLock::new(DashMap::new);

#[must_use]
pub(crate) fn synthetic_user_message_update(
    session_id: &str,
    prompt: &[ContentBlock],
    attempt_id: Option<&str>,
) -> Option<SessionUpdate> {
    let text = prompt_display_text(prompt)?;
    Some(SessionUpdate::UserMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text { text },
            aggregation_hint: None,
        },
        session_id: Some(session_id.to_string()),
        attempt_id: attempt_id.map(str::to_string),
    })
}

pub(crate) fn remember_synthetic_user_prompt(update: &SessionUpdate) {
    let Some((session_id, text)) = session_text_pair(update) else {
        return;
    };

    let mut queue = PENDING_PROMPT_ECHOES.entry(session_id).or_default();
    queue.push_back(text);
}

#[must_use]
pub(crate) fn consume_matching_user_echo(update: &SessionUpdate) -> bool {
    let Some((session_id, text)) = session_text_pair(update) else {
        return false;
    };

    let Some(mut queue) = PENDING_PROMPT_ECHOES.get_mut(&session_id) else {
        return false;
    };

    if queue.front().is_none_or(|pending| pending != &text) {
        return false;
    }

    queue.pop_front();
    let queue_is_empty = queue.is_empty();
    drop(queue);

    if queue_is_empty {
        PENDING_PROMPT_ECHOES.remove(&session_id);
    }

    true
}

pub(crate) fn discard_pending_prompt_echo(session_id: &str) {
    let Some(mut queue) = PENDING_PROMPT_ECHOES.get_mut(session_id) else {
        return;
    };

    queue.pop_front();
    let queue_is_empty = queue.is_empty();
    drop(queue);

    if queue_is_empty {
        PENDING_PROMPT_ECHOES.remove(session_id);
    }
}

fn prompt_display_text(prompt: &[ContentBlock]) -> Option<String> {
    let blocks = prompt
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } if !text.trim().is_empty() => Some(text.clone()),
            ContentBlock::Image { .. } => Some("[Image]".to_string()),
            _ => None,
        })
        .collect::<Vec<_>>();

    if blocks.is_empty() {
        return None;
    }

    let text = blocks.join("\n");
    if is_claude_local_command_message(&text) {
        return None;
    }

    Some(text)
}

fn session_text_pair(update: &SessionUpdate) -> Option<(String, String)> {
    let SessionUpdate::UserMessageChunk {
        chunk, session_id, ..
    } = update
    else {
        return None;
    };
    let session_id = session_id.clone()?;
    let ContentBlock::Text { text } = &chunk.content else {
        return None;
    };
    Some((session_id, text.clone()))
}

fn is_claude_local_command_message(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.contains("<command-name>")
        || trimmed.contains("<command-message>")
        || trimmed.contains("<local-command-stdout>")
}

#[cfg(test)]
pub(crate) fn clear_pending_prompt_echoes() {
    PENDING_PROMPT_ECHOES.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_synthetic_user_message_from_text_prompt() {
        let update = synthetic_user_message_update(
            "session-build",
            &[ContentBlock::Text {
                text: "hello".to_string(),
            }],
            None,
        )
        .expect("synthetic update");

        match update {
            SessionUpdate::UserMessageChunk {
                chunk,
                session_id,
                attempt_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("session-build"));
                assert_eq!(attempt_id, None);
                match chunk.content {
                    ContentBlock::Text { text } => assert_eq!(text, "hello"),
                    _ => panic!("expected text chunk"),
                }
            }
            _ => panic!("expected user message chunk"),
        }
    }

    #[test]
    fn builds_synthetic_user_message_from_image_only_prompt() {
        let update = synthetic_user_message_update(
            "session-image",
            &[ContentBlock::Image {
                data: "base64-image".to_string(),
                mime_type: "image/png".to_string(),
                uri: Some("file:///tmp/prompt.png".to_string()),
            }],
            None,
        )
        .expect("synthetic update");

        match update {
            SessionUpdate::UserMessageChunk {
                chunk,
                session_id,
                attempt_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("session-image"));
                assert_eq!(attempt_id, None);
                match chunk.content {
                    ContentBlock::Text { text } => assert_eq!(text, "[Image]"),
                    _ => panic!("expected text chunk"),
                }
            }
            _ => panic!("expected user message chunk"),
        }
    }

    #[test]
    fn skips_synthetic_user_message_for_local_command_prompt() {
        let update = synthetic_user_message_update(
            "session-command",
            &[ContentBlock::Text {
                text: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>claude-sonnet-4-6</command-args>".to_string(),
            }],
            Some("attempt-command"),
        );

        assert!(update.is_none());
    }

    #[test]
    fn consumes_matching_provider_echo_once() {
        clear_pending_prompt_echoes();
        let update = synthetic_user_message_update(
            "session-consume",
            &[ContentBlock::Text {
                text: "hello".to_string(),
            }],
            None,
        )
        .expect("synthetic update");

        remember_synthetic_user_prompt(&update);

        assert!(consume_matching_user_echo(&update));
        assert!(!consume_matching_user_echo(&update));
        clear_pending_prompt_echoes();
    }

    #[test]
    fn discard_clears_stale_pending_prompt() {
        clear_pending_prompt_echoes();
        let update = synthetic_user_message_update(
            "session-discard",
            &[ContentBlock::Text {
                text: "hello".to_string(),
            }],
            None,
        )
        .expect("synthetic update");

        remember_synthetic_user_prompt(&update);
        discard_pending_prompt_echo("session-discard");

        assert!(!consume_matching_user_echo(&update));
        clear_pending_prompt_echoes();
    }
}
