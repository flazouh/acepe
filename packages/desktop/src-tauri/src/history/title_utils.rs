//! Shared session title derivation utility.
//!
//! Provides a single function `derive_session_title` that all parsers call
//! with pre-extracted user message text. Callers are responsible for extracting
//! raw text from their format-specific structures (JSONL, SQLite blobs, etc.)
//! and stripping format-specific wrappers (e.g. `<user_query>` tags).

use regex::Regex;
use std::borrow::Cow;
use std::sync::OnceLock;

/// Strip XML-style system tags from text content.
///
/// Finds opening tags, then strips the matching `<tag>...</tag>` pair (or orphan
/// `<tag>...` to end of string). This handles all system-injected context tags
/// without needing to enumerate them individually.
fn strip_xml_tags(text: &str) -> Cow<'_, str> {
    static OPEN_TAG: OnceLock<Regex> = OnceLock::new();
    let open_tag = OPEN_TAG.get_or_init(|| Regex::new(r"<([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>").unwrap());

    // Collect unique tag names present in the text
    let tag_names: Vec<String> = open_tag
        .captures_iter(text)
        .map(|cap| cap[1].to_string())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    if tag_names.is_empty() {
        return Cow::Borrowed(text);
    }

    let mut result = text.to_string();
    for tag in &tag_names {
        // Build a pattern for this specific tag: matched pair OR orphan to end
        let pattern_str = format!(
            r"(?s)<{tag}[^>]*>.*?</{tag}[^>]*>|<{tag}[^>]*>.*$",
            tag = regex::escape(tag)
        );
        if let Ok(pattern) = Regex::new(&pattern_str) {
            result = pattern.replace_all(&result, "").into_owned();
        }
    }

    if result == text {
        Cow::Borrowed(text)
    } else {
        Cow::Owned(result)
    }
}

/// Normalize a title string for display: collapse newlines and literal "\n" to spaces, trim.
/// Returns "Untitled" if the result would be empty.
/// Used when falling back to metadata name (e.g. Cursor store.db meta.name) so
/// titles like "\nhi\n" or the literal characters backslash-n are shown as "hi".
pub(crate) fn normalize_display_title(name: &str) -> String {
    let collapsed = name
        .replace("\\n", " ")
        .replace("\r\n", " ")
        .replace('\n', " ");
    let s = collapsed.trim();
    if s.is_empty() {
        "Untitled".to_string()
    } else {
        s.to_string()
    }
}

/// Check if content is a command message.
fn is_command_message(content: &str) -> bool {
    let trimmed = content.trim();
    trimmed.starts_with('/')
        || trimmed.contains("<command-name>")
        || trimmed.contains("<command-message>")
        || trimmed.contains("<local-command-stdout>")
}

/// Derive a session title from the first user message text.
///
/// Returns `None` if the text is empty, a command, or meaningless after cleaning.
///
/// Pipeline:
/// 1. Collapse newlines to spaces, trim whitespace
/// 2. Strip artifact tags (`<ide_*>`, `<pasted-content>`, `<system-reminder>`)
/// 3. Reject command messages (slash commands, XML command tags)
/// 4. Reject "warmup" sentinel
/// 5. Return `None` if empty after cleaning
/// 6. Truncate to `max_len` chars with "..." suffix
pub(crate) fn derive_session_title(text: &str, max_len: usize) -> Option<String> {
    // Collapse newlines and literal "\n" to spaces, trim
    let collapsed = text
        .replace("\\n", " ")
        .replace("\r\n", " ")
        .replace('\n', " ");
    let trimmed = collapsed.trim();

    if trimmed.is_empty() {
        return None;
    }

    // Strip artifact tags
    let cleaned = strip_xml_tags(trimmed);
    let cleaned = cleaned.trim();

    if cleaned.is_empty() {
        return None;
    }

    // Reject command messages and warmup sentinel
    if is_command_message(cleaned) || cleaned.eq_ignore_ascii_case("warmup") {
        return None;
    }

    // Truncate to max_len chars
    let char_count = cleaned.chars().count();
    if char_count <= max_len {
        Some(cleaned.to_string())
    } else {
        let truncate_len = max_len.saturating_sub(3);
        let truncated: String = cleaned.chars().take(truncate_len).collect();
        Some(format!("{}...", truncated.trim_end()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_text() {
        assert_eq!(
            derive_session_title("Hello, how are you?", 100),
            Some("Hello, how are you?".to_string())
        );
    }

    #[test]
    fn test_empty_input() {
        assert_eq!(derive_session_title("", 100), None);
        assert_eq!(derive_session_title("   ", 100), None);
        assert_eq!(derive_session_title("\n\n", 100), None);
    }

    #[test]
    fn test_newline_collapsing() {
        assert_eq!(
            derive_session_title("Hello\nworld\nhow are you", 100),
            Some("Hello world how are you".to_string())
        );
    }

    #[test]
    fn test_truncation() {
        let long_text = "a".repeat(150);
        let result = derive_session_title(&long_text, 100).unwrap();
        assert!(result.ends_with("..."));
        assert!(result.chars().count() <= 100);
    }

    #[test]
    fn test_truncation_at_80() {
        let long_text = "a".repeat(100);
        let result = derive_session_title(&long_text, 80).unwrap();
        assert!(result.ends_with("..."));
        assert!(result.chars().count() <= 80);
    }

    #[test]
    fn test_exact_max_len_no_truncation() {
        let text = "a".repeat(100);
        let result = derive_session_title(&text, 100).unwrap();
        assert_eq!(result.chars().count(), 100);
        assert!(!result.ends_with("..."));
    }

    #[test]
    fn test_command_messages_rejected() {
        assert_eq!(derive_session_title("/help", 100), None);
        assert_eq!(derive_session_title("/commit fix bug", 100), None);
        // Command tags are stripped as XML, leaving surrounding text
        assert_eq!(
            derive_session_title("some text <command-name>foo</command-name>", 100),
            Some("some text".to_string())
        );
        // Pure command tag content becomes None
        assert_eq!(
            derive_session_title("<command-name>foo</command-name>", 100),
            None
        );
        assert_eq!(
            derive_session_title("<local-command-stdout>output</local-command-stdout>", 100),
            None
        );
    }

    #[test]
    fn test_warmup_rejected() {
        assert_eq!(derive_session_title("warmup", 100), None);
        assert_eq!(derive_session_title("WARMUP", 100), None);
        assert_eq!(derive_session_title("  Warmup  ", 100), None);
    }

    #[test]
    fn test_artifact_tags_stripped() {
        assert_eq!(
            derive_session_title(
                "<ide_opened_file>some/path</ide_opened_file>Fix the bug please",
                100
            ),
            Some("Fix the bug please".to_string())
        );
    }

    #[test]
    fn test_artifact_only_returns_none() {
        assert_eq!(
            derive_session_title("<ide_opened_file>some/path</ide_opened_file>", 100),
            None
        );
    }

    #[test]
    fn test_system_reminder_stripped() {
        assert_eq!(
            derive_session_title(
                "<system-reminder>context</system-reminder>Help me refactor this",
                100
            ),
            Some("Help me refactor this".to_string())
        );
    }

    #[test]
    fn test_pasted_content_stripped() {
        assert_eq!(
            derive_session_title(
                "Review this code <pasted-content>fn main() {}</pasted-content>",
                100
            ),
            Some("Review this code".to_string())
        );
    }

    #[test]
    fn test_unicode_truncation() {
        // Each emoji is 1 char but multiple bytes
        let text = "🎉".repeat(50);
        let result = derive_session_title(&text, 20).unwrap();
        assert!(result.ends_with("..."));
        assert!(result.chars().count() <= 20);
    }

    #[test]
    fn test_malformed_closing_tag() {
        // Opening tag without proper closing tag - should still strip
        assert_eq!(
            derive_session_title("<ide_opened_file>some/long/path/that/never/closes", 100),
            None
        );
    }

    #[test]
    fn test_user_info_stripped() {
        assert_eq!(
            derive_session_title(
                "<user_info>OS Version: Darwin 25.2.0\nShell: zsh</user_info>Fix the bug",
                100
            ),
            Some("Fix the bug".to_string())
        );
        // user-info variant (hyphenated)
        assert_eq!(
            derive_session_title("<user-info>system context</user-info>Help me refactor", 100),
            Some("Help me refactor".to_string())
        );
    }

    #[test]
    fn test_user_info_only_returns_none() {
        assert_eq!(
            derive_session_title(
                "<user_info>OS Version: Darwin 25.2.0\nShell: zsh\nPlatform: darwin</user_info>",
                100
            ),
            None
        );
    }

    #[test]
    fn test_environment_context_stripped() {
        assert_eq!(
            derive_session_title(
                "<environment_context>project info here</environment_context>What does this code do?",
                100
            ),
            Some("What does this code do?".to_string())
        );
    }

    #[test]
    fn test_git_status_stripped() {
        assert_eq!(
            derive_session_title(
                "<git_status>This Is The Git Status...</git_status>Fix the tests",
                100
            ),
            Some("Fix the tests".to_string())
        );
    }

    #[test]
    fn test_multiple_tags_stripped() {
        assert_eq!(
            derive_session_title(
                "<user_info>OS info</user_info><git_status>status</git_status><ide_opened_file>path</ide_opened_file>Hello world",
                100
            ),
            Some("Hello world".to_string())
        );
    }

    #[test]
    fn test_all_tags_returns_none() {
        assert_eq!(
            derive_session_title(
                "<user_info>OS info</user_info><git_status>status</git_status>",
                100
            ),
            None
        );
    }

    #[test]
    fn test_preserves_plain_text_with_angle_brackets() {
        // Plain text with < that isn't a tag should be preserved
        assert_eq!(
            derive_session_title("x < 5 and y > 3", 100),
            Some("x < 5 and y > 3".to_string())
        );
    }

    #[test]
    fn test_normalize_display_title_strips_newlines() {
        assert_eq!(normalize_display_title("\nhi\n"), "hi");
        assert_eq!(normalize_display_title("  hi  \n"), "hi");
        assert_eq!(normalize_display_title("\n\n"), "Untitled");
        assert_eq!(normalize_display_title(""), "Untitled");
        assert_eq!(normalize_display_title("Hello world"), "Hello world");
    }

    #[test]
    fn test_normalize_display_title_strips_literal_backslash_n() {
        // Literal \n (backslash + n) as stored by Cursor in some paths
        assert_eq!(normalize_display_title(r"\nhi\n"), "hi");
        assert_eq!(
            normalize_display_title(r"\ncan you clone\n"),
            "can you clone"
        );
    }
}
