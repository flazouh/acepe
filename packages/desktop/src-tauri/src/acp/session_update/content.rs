use super::ContentChunk;
use crate::acp::types::ContentBlock;

pub(crate) fn deserialize_content_chunk<E>(data: &serde_json::Value) -> Result<ContentChunk, E>
where
    E: serde::de::Error,
{
    // Try direct format first: { content: ContentBlock }
    if let Some(content) = data.get("content") {
        let content_block: ContentBlock =
            serde_json::from_value(content.clone()).map_err(serde::de::Error::custom)?;
        return Ok(ContentChunk {
            content: content_block,
        });
    }

    // Try nested format: { chunk: { content: ContentBlock } }
    if let Some(chunk) = data.get("chunk") {
        if let Some(content) = chunk.get("content") {
            let content_block: ContentBlock =
                serde_json::from_value(content.clone()).map_err(serde::de::Error::custom)?;
            return Ok(ContentChunk {
                content: content_block,
            });
        }
    }

    Err(serde::de::Error::custom("Invalid content chunk format"))
}
