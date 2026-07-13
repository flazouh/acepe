//! Shared `StoredEntry` ↔ `ProviderEvent` mapping for disk-history providers.

use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_update::TurnErrorKind;
use crate::acp::types::CanonicalAgentId;
use crate::cc_sdk::AssistantMessageError;
use crate::session_jsonl::types::{
    StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    StoredErrorMessage, StoredUserMessage,
};

/// Map legacy stored transcript rows to ingress events for fold replay.
#[must_use]
pub fn stored_entries_to_provider_events(
    entries: &[StoredEntry],
    source: CanonicalAgentId,
) -> Vec<ProviderEvent> {
    let mut events = Vec::new();
    let mut provider_seq = 0_u64;

    for entry in entries {
        match entry {
            StoredEntry::User {
                id,
                message,
                timestamp,
            } => {
                if let Some(text) = message
                    .content
                    .text
                    .as_ref()
                    .filter(|text| !text.trim().is_empty())
                {
                    provider_seq += 1;
                    events.push(ProviderEvent {
                        source: source.clone(),
                        provider_seq,
                        provider_row_id: id.clone(),
                        timestamp_ms: parse_timestamp_to_millis(timestamp.as_deref()),
                        kind: ProviderEventKind::UserText {
                            text: text.clone(),
                            attempt_id: None,
                        },
                    });
                }
            }
            StoredEntry::Assistant {
                id,
                message,
                timestamp,
            } => {
                for chunk in &message.chunks {
                    let Some(text) = chunk
                        .block
                        .text
                        .as_ref()
                        .filter(|text| !text.trim().is_empty())
                    else {
                        continue;
                    };

                    provider_seq += 1;
                    let kind = if chunk.chunk_type == "thought" {
                        ProviderEventKind::AssistantThought {
                            text: text.clone(),
                            redacted: None,
                        }
                    } else {
                        ProviderEventKind::AssistantText { text: text.clone() }
                    };

                    events.push(ProviderEvent {
                        source: source.clone(),
                        provider_seq,
                        provider_row_id: id.clone(),
                        timestamp_ms: parse_timestamp_to_millis(timestamp.as_deref()),
                        kind,
                    });
                }
            }
            StoredEntry::ToolCall {
                id: _,
                message,
                timestamp,
            } => {
                provider_seq += 1;
                events.push(ProviderEvent {
                    source: source.clone(),
                    provider_seq,
                    provider_row_id: message.id.clone(),
                    timestamp_ms: parse_timestamp_to_millis(timestamp.as_deref()),
                    kind: ProviderEventKind::ToolCall(message.clone()),
                });
            }
            StoredEntry::Error {
                id,
                message,
                timestamp,
            } => {
                provider_seq += 1;
                events.push(ProviderEvent {
                    source: source.clone(),
                    provider_seq,
                    provider_row_id: id.clone(),
                    timestamp_ms: parse_timestamp_to_millis(timestamp.as_deref()),
                    kind: ProviderEventKind::AssistantError {
                        text: message.content.clone(),
                        error: assistant_message_error_from_stored(message),
                    },
                });
            }
        }
    }

    events
}

/// Map ingress provider events back to compat `StoredEntry` rows (export boundary only).
#[must_use]
pub fn provider_events_to_stored_entries(events: &[ProviderEvent]) -> Vec<StoredEntry> {
    let mut entries = Vec::new();

    for event in events {
        let timestamp = timestamp_ms_to_rfc3339(event.timestamp_ms);
        match &event.kind {
            ProviderEventKind::UserText { text, .. } => {
                if text.trim().is_empty() {
                    continue;
                }
                entries.push(StoredEntry::User {
                    id: event.provider_row_id.clone(),
                    message: StoredUserMessage {
                        id: Some(event.provider_row_id.clone()),
                        content: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some(text.clone()),
                        },
                        chunks: vec![StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some(text.clone()),
                        }],
                        sent_at: timestamp.clone(),
                    },
                    timestamp,
                });
            }
            ProviderEventKind::AssistantText { text } => {
                if text.trim().is_empty() {
                    continue;
                }
                entries.push(stored_assistant_entry(
                    &event.provider_row_id,
                    "message",
                    text,
                    timestamp,
                ));
            }
            ProviderEventKind::AssistantThought { text, .. } => {
                if text.trim().is_empty() {
                    continue;
                }
                entries.push(stored_assistant_entry(
                    &event.provider_row_id,
                    "thought",
                    text,
                    timestamp,
                ));
            }
            ProviderEventKind::ToolCall(tool_call) => {
                entries.push(StoredEntry::ToolCall {
                    id: event.provider_row_id.clone(),
                    message: tool_call.clone(),
                    timestamp,
                });
            }
            ProviderEventKind::AssistantError { text, error } => {
                entries.push(StoredEntry::Error {
                    id: event.provider_row_id.clone(),
                    message: StoredErrorMessage {
                        content: text.clone(),
                        code: match error {
                            AssistantMessageError::RateLimit => Some("429".to_string()),
                            _ => None,
                        },
                        details: None,
                        kind: match error {
                            AssistantMessageError::InvalidRequest => TurnErrorKind::Fatal,
                            _ => TurnErrorKind::Recoverable,
                        },
                        source: None,
                    },
                    timestamp,
                });
            }
            _ => {}
        }
    }

    entries
}

fn stored_assistant_entry(
    id: &str,
    chunk_type: &str,
    text: &str,
    timestamp: Option<String>,
) -> StoredEntry {
    StoredEntry::Assistant {
        id: id.to_string(),
        message: StoredAssistantMessage {
            chunks: vec![StoredAssistantChunk {
                chunk_type: chunk_type.to_string(),
                block: StoredContentBlock {
                    block_type: "text".to_string(),
                    text: Some(text.to_string()),
                },
            }],
            model: None,
            display_model: None,
            received_at: timestamp.clone(),
        },
        timestamp,
    }
}

fn timestamp_ms_to_rfc3339(timestamp_ms: Option<i64>) -> Option<String> {
    timestamp_ms.and_then(|value| {
        chrono::DateTime::<chrono::Utc>::from_timestamp_millis(value).map(|dt| dt.to_rfc3339())
    })
}

fn assistant_message_error_from_stored(
    message: &crate::session_jsonl::types::StoredErrorMessage,
) -> AssistantMessageError {
    if message.code.as_deref() == Some("429") {
        return AssistantMessageError::RateLimit;
    }

    match message.kind {
        TurnErrorKind::Fatal => AssistantMessageError::InvalidRequest,
        TurnErrorKind::Recoverable => AssistantMessageError::Unknown,
    }
}

fn parse_timestamp_to_millis(timestamp: Option<&str>) -> Option<i64> {
    timestamp.and_then(|value| {
        chrono::DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|dt| dt.timestamp_millis())
    })
}
