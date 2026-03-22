use serde::{Deserialize, Serialize};
use specta::Type;

/// ContentChunk represents a chunk of content being streamed.
///
/// This handles both direct format `{ content: ContentBlock }`
/// and nested format `{ chunk: { content: ContentBlock } }`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContentChunk {
    pub content: crate::acp::types::ContentBlock,
}
