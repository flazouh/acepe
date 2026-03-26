//! Attachment Token Expander
//!
//! Decodes `@[text:BASE64]` tokens in prompt text blocks into `<pasted-content>` XML blocks.
//! This runs in the Tauri command layer (before any backend) so all agent clients
//! (ACP subprocess, cc_sdk, OpenCode HTTP) receive decoded content.
//!
//! The frontend encodes pasted text as: `btoa(unescape(encodeURIComponent(content)))`,
//! which produces standard base64 of the UTF-8 bytes.

use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use std::sync::LazyLock;

use crate::acp::types::{ContentBlock, PromptRequest};

/// Matches `@[text:VALUE]` where VALUE contains no `]`.
static TEXT_TOKEN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@\[text:([^\]]+)\]").expect("invalid regex"));

/// Expand all `@[text:BASE64]` tokens in every text block of a [`PromptRequest`].
///
/// Mutates in place for zero-copy efficiency. Tokens that fail to decode are left
/// as-is so the agent sees a clear error rather than silent data loss.
pub fn expand_text_tokens(request: &mut PromptRequest) {
    for block in &mut request.prompt {
        if let ContentBlock::Text { text } = block {
            if text.contains("@[text:") {
                *text = expand_text_tokens_in_str(text);
            }
        }
    }
}

/// Expand `@[text:BASE64]` tokens in a single string.
fn expand_text_tokens_in_str(input: &str) -> String {
    TEXT_TOKEN_RE
        .replace_all(input, |caps: &regex::Captures| {
            let base64_value = &caps[1];
            match decode_base64_utf8(base64_value) {
                Some(decoded) => {
                    let line_count = decoded.matches('\n').count() + 1;
                    format!(
                        "<pasted-content lines=\"{}\">\n{}\n</pasted-content>",
                        line_count, decoded
                    )
                }
                None => {
                    tracing::warn!(
                        token = base64_value,
                        "Failed to decode @[text:...] base64 token; leaving as-is"
                    );
                    caps[0].to_string()
                }
            }
        })
        .into_owned()
}

/// Decode a base64 string to UTF-8.
fn decode_base64_utf8(encoded: &str) -> Option<String> {
    let bytes = STANDARD.decode(encoded).ok()?;
    String::from_utf8(bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_single_text_token() {
        // "Hello World" in base64
        let input = "@[text:SGVsbG8gV29ybGQ=]\nPlease review this";
        let result = expand_text_tokens_in_str(input);

        assert!(result.contains("<pasted-content lines=\"1\">"));
        assert!(result.contains("Hello World"));
        assert!(result.contains("</pasted-content>"));
        assert!(result.contains("Please review this"));
        assert!(!result.contains("@[text:"));
    }

    #[test]
    fn expands_multiline_content() {
        // "line1\nline2\nline3" in base64
        let content = "line1\nline2\nline3";
        let encoded = STANDARD.encode(content.as_bytes());
        let input = format!("@[text:{}]\ncheck this", encoded);
        let result = expand_text_tokens_in_str(&input);

        assert!(result.contains("<pasted-content lines=\"3\">"));
        assert!(result.contains("line1\nline2\nline3"));
        assert!(!result.contains("@[text:"));
    }

    #[test]
    fn expands_utf8_content() {
        // UTF-8 content with emoji and accented chars
        let content = "café ☕ naïve";
        let encoded = STANDARD.encode(content.as_bytes());
        let input = format!("@[text:{}]", encoded);
        let result = expand_text_tokens_in_str(&input);

        assert!(result.contains("café ☕ naïve"));
        assert!(!result.contains("@[text:"));
    }

    #[test]
    fn leaves_invalid_base64_as_is() {
        let input = "@[text:!!!not-valid-base64!!!] some text";
        let result = expand_text_tokens_in_str(input);

        // Invalid base64 should be left unchanged
        assert!(result.contains("@[text:!!!not-valid-base64!!!]"));
    }

    #[test]
    fn expands_multiple_tokens() {
        let encoded1 = STANDARD.encode(b"first");
        let encoded2 = STANDARD.encode(b"second");
        let input = format!("@[text:{}] middle @[text:{}] end", encoded1, encoded2);
        let result = expand_text_tokens_in_str(&input);

        assert!(result.contains("first"));
        assert!(result.contains("second"));
        assert!(!result.contains("@[text:"));
    }

    #[test]
    fn ignores_non_text_tokens() {
        let input = "@[file:/path/to/code.ts]\n@[image:/path/to/img.png]\ncheck these";
        let result = expand_text_tokens_in_str(input);

        // Non-text tokens should be untouched
        assert_eq!(result, input);
    }

    #[test]
    fn no_tokens_is_noop() {
        let input = "Just a normal message with no tokens";
        let result = expand_text_tokens_in_str(input);

        assert_eq!(result, input);
    }

    #[test]
    fn expand_text_tokens_mutates_prompt_request() {
        let encoded = STANDARD.encode(b"hello world");
        let mut request = PromptRequest {
            session_id: "test".to_string(),
            prompt: vec![
                ContentBlock::Text {
                    text: format!("@[text:{}]\nPlease summarize", encoded),
                },
                ContentBlock::Image {
                    data: "abc".to_string(),
                    mime_type: "image/png".to_string(),
                    uri: None,
                },
                ContentBlock::Text {
                    text: "no tokens here".to_string(),
                },
            ],
            stream: Some(true),
        };

        expand_text_tokens(&mut request);

        // First text block should be expanded
        if let ContentBlock::Text { text } = &request.prompt[0] {
            assert!(text.contains("<pasted-content"));
            assert!(text.contains("hello world"));
            assert!(!text.contains("@[text:"));
        } else {
            panic!("Expected Text block");
        }

        // Image block unchanged
        assert!(matches!(&request.prompt[1], ContentBlock::Image { .. }));

        // Second text block unchanged (no tokens)
        if let ContentBlock::Text { text } = &request.prompt[2] {
            assert_eq!(text, "no tokens here");
        } else {
            panic!("Expected Text block");
        }
    }
}
