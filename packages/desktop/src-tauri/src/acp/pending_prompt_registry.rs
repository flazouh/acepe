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
) -> Option<SessionUpdate> {
    let text = prompt_text(prompt)?;
    Some(SessionUpdate::UserMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text { text },
            aggregation_hint: None,
        },
        session_id: Some(session_id.to_string()),
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

fn prompt_text(prompt: &[ContentBlock]) -> Option<String> {
    let text_blocks = prompt
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } if !text.trim().is_empty() => Some(text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();

    if text_blocks.is_empty() {
        return None;
    }

    Some(text_blocks.join("\n"))
}

fn session_text_pair(update: &SessionUpdate) -> Option<(String, String)> {
    let SessionUpdate::UserMessageChunk { chunk, session_id } = update else {
        return None;
    };
    let session_id = session_id.clone()?;
    let ContentBlock::Text { text } = &chunk.content else {
        return None;
    };
    Some((session_id, text.clone()))
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
        )
        .expect("synthetic update");

        match update {
            SessionUpdate::UserMessageChunk { chunk, session_id } => {
                assert_eq!(session_id.as_deref(), Some("session-build"));
                match chunk.content {
                    ContentBlock::Text { text } => assert_eq!(text, "hello"),
                    _ => panic!("expected text chunk"),
                }
            }
            _ => panic!("expected user message chunk"),
        }
    }

    #[test]
    fn consumes_matching_provider_echo_once() {
        clear_pending_prompt_echoes();
        let update = synthetic_user_message_update(
            "session-consume",
            &[ContentBlock::Text {
                text: "hello".to_string(),
            }],
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
        )
        .expect("synthetic update");

        remember_synthetic_user_prompt(&update);
        discard_pending_prompt_echo("session-discard");

        assert!(!consume_matching_user_echo(&update));
        clear_pending_prompt_echoes();
    }
}
