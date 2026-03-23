//! Partial JSON parsing for streaming tool input.
//!
//! When tool arguments stream in character-by-character, we receive incomplete
//! JSON that cannot be parsed directly. This module provides utilities to
//! recover valid partial JSON from incomplete input.

use partial_json_fixer::fix_json;

/// Parse potentially incomplete JSON, returning valid partial results.
///
/// Uses a two-step approach:
/// 1. Fast path: Try direct parsing with serde_json (already complete)
/// 2. Recovery: Use partial-json-fixer to close incomplete structures
///
/// # Examples
///
/// ```
/// use acepe_lib::acp::partial_json::parse_partial_json;
///
/// // Complete JSON parses directly
/// let complete = r#"{"todos": [{"content": "task 1", "status": "pending"}]}"#;
/// assert!(parse_partial_json(complete).is_some());
///
/// // Incomplete JSON is recovered
/// let incomplete = r#"{"todos": [{"content": "task 1", "status": "pend"#;
/// let result = parse_partial_json(incomplete);
/// assert!(result.is_some());
/// ```
pub fn parse_partial_json(input: &str) -> Option<serde_json::Value> {
    // Fast path: try complete parse first (serde_json is highly optimized)
    if let Ok(value) = serde_json::from_str(input) {
        return Some(value);
    }

    // Recovery: use battle-tested partial-json-fixer
    let fixed = fix_json(input);
    serde_json::from_str(&fixed).ok()
}

/// Quick validity check without full parse.
///
/// Returns true if brackets and braces are balanced and strings are closed.
/// Useful as a fast pre-check before expensive parsing.
#[allow(dead_code)]
pub fn is_likely_complete(input: &str) -> bool {
    let mut braces = 0i32;
    let mut brackets = 0i32;
    let mut in_string = false;
    let mut escape_next = false;

    for c in input.chars() {
        if escape_next {
            escape_next = false;
            continue;
        }
        match c {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '{' if !in_string => braces += 1,
            '}' if !in_string => braces -= 1,
            '[' if !in_string => brackets += 1,
            ']' if !in_string => brackets -= 1,
            _ => {}
        }
    }
    braces == 0 && brackets == 0 && !in_string
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_complete_json_parses_directly() {
        let complete = r#"{"todos": [{"content": "task 1", "status": "pending"}]}"#;
        let result = parse_partial_json(complete);
        assert!(result.is_some());
        let value = result.unwrap();
        assert!(value.get("todos").is_some());
    }

    #[test]
    fn test_incomplete_object() {
        let incomplete = r#"{"todos": [{"content": "task 1"#;
        let result = parse_partial_json(incomplete);
        assert!(result.is_some());
    }

    #[test]
    fn test_incomplete_array() {
        let incomplete = r#"{"todos": [1, 2, 3"#;
        let result = parse_partial_json(incomplete);
        assert!(result.is_some());
    }

    #[test]
    fn test_incomplete_string() {
        let incomplete = r#"{"name": "test val"#;
        let result = parse_partial_json(incomplete);
        // Should recover with truncated string
        assert!(result.is_some());
    }

    #[test]
    fn test_empty_input() {
        let result = parse_partial_json("");
        // Empty string should fail to parse
        assert!(result.is_none());
    }

    #[test]
    fn test_nested_incomplete() {
        let incomplete = r#"{"a": {"b": {"c": ["#;
        let result = parse_partial_json(incomplete);
        assert!(result.is_some());
    }

    #[test]
    fn test_is_likely_complete_balanced() {
        assert!(is_likely_complete(r#"{"a": 1}"#));
        assert!(is_likely_complete(r#"[1, 2, 3]"#));
        assert!(is_likely_complete(r#"{"a": [1, 2], "b": {"c": 3}}"#));
    }

    #[test]
    fn test_is_likely_complete_unbalanced() {
        assert!(!is_likely_complete(r#"{"a": 1"#));
        assert!(!is_likely_complete(r#"[1, 2, 3"#));
        assert!(!is_likely_complete(r#"{"a": [1, 2"#));
    }

    #[test]
    fn test_is_likely_complete_unclosed_string() {
        assert!(!is_likely_complete(r#"{"name": "test"#));
    }

    #[test]
    fn test_is_likely_complete_escaped_quotes() {
        assert!(is_likely_complete(r#"{"name": "test \"quote\""}"#));
        assert!(!is_likely_complete(r#"{"name": "test \"quote"#));
    }
}
