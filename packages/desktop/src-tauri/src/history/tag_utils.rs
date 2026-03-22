//! Shared tag-stripping utilities for Cursor text sanitization.
//!
//! Used by both `cursor_sqlite_parser` (store.db format) and
//! `cursor_history::parser::txt_transcript` (plain-text transcript format).

/// Remove entire tag blocks (opening tag + inner content + closing tag),
/// case-insensitively.
///
/// If the closing tag is missing, only the opening tag token is removed.
pub(crate) fn remove_tag_block_ci(input: &str, tag: &str) -> String {
    let mut output = input.to_string();
    let open_prefix = format!("<{}", tag);
    let close_prefix = format!("</{}", tag);

    loop {
        let lowered = output.to_lowercase();
        let Some(start) = lowered.find(&open_prefix) else {
            break;
        };
        let Some(open_end_rel) = lowered[start..].find('>') else {
            break;
        };
        let open_end = start + open_end_rel + 1;

        let Some(close_start_rel) = lowered[open_end..].find(&close_prefix) else {
            output.replace_range(start..open_end, "");
            continue;
        };
        let close_start = open_end + close_start_rel;
        let Some(close_end_rel) = lowered[close_start..].find('>') else {
            output.replace_range(start..open_end, "");
            continue;
        };
        let close_end = close_start + close_end_rel + 1;
        output.replace_range(start..close_end, "");
    }

    output
}

/// Remove stray tag tokens (opening or closing) without matching pairs,
/// case-insensitively.
pub(crate) fn remove_tag_tokens_ci(input: &str, tag: &str) -> String {
    let mut output = input.to_string();
    let open_prefix = format!("<{}", tag);
    let close_prefix = format!("</{}", tag);

    loop {
        let lowered = output.to_lowercase();
        let Some(start) = lowered.find(&open_prefix) else {
            break;
        };
        let Some(end_rel) = lowered[start..].find('>') else {
            break;
        };
        let end = start + end_rel + 1;
        output.replace_range(start..end, "");
    }

    loop {
        let lowered = output.to_lowercase();
        let Some(start) = lowered.find(&close_prefix) else {
            break;
        };
        let Some(end_rel) = lowered[start..].find('>') else {
            break;
        };
        let end = start + end_rel + 1;
        output.replace_range(start..end, "");
    }

    output
}

/// Unwrap a tag: remove opening and closing tag tokens but preserve inner
/// content, case-insensitively.
pub(crate) fn unwrap_tag_ci(input: &str, tag: &str) -> String {
    let mut result = input.to_string();
    let open_prefix = format!("<{}", tag);
    let close_tag = format!("</{}", tag);

    // Remove closing tags first (simpler — no inner content)
    while let Some(pos) = result.to_lowercase().find(&close_tag) {
        let Some(rel) = result[pos..].find('>') else {
            break; // malformed tag without '>' — stop to avoid infinite loop
        };
        result.replace_range(pos..pos + rel + 1, "");
    }

    // Remove opening tags (may have attributes)
    while let Some(pos) = result.to_lowercase().find(&open_prefix) {
        let Some(rel) = result[pos..].find('>') else {
            break; // malformed tag without '>' — stop to avoid infinite loop
        };
        result.replace_range(pos..pos + rel + 1, "");
    }

    result
}

/// Check if a line is a bare timestamp like "12:34:56".
pub(crate) fn is_timestamp_line(line: &str) -> bool {
    let parts = line.split(':').collect::<Vec<_>>();
    if parts.len() != 3 {
        return false;
    }

    let hour = parts[0];
    let minute = parts[1];
    let second = parts[2];

    let hour_ok = (hour.len() == 1 || hour.len() == 2) && hour.chars().all(|c| c.is_ascii_digit());
    let minute_ok = minute.len() == 2 && minute.chars().all(|c| c.is_ascii_digit());
    let second_ok = second.len() == 2 && second.chars().all(|c| c.is_ascii_digit());

    hour_ok && minute_ok && second_ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remove_tag_block_strips_full_block() {
        let input = "before<think>inner</think>after";
        assert_eq!(remove_tag_block_ci(input, "think"), "beforeafter");
    }

    #[test]
    fn remove_tag_block_case_insensitive() {
        let input = "before<THINK>inner</Think>after";
        assert_eq!(remove_tag_block_ci(input, "think"), "beforeafter");
    }

    #[test]
    fn remove_tag_block_missing_close() {
        let input = "before<think>orphan content after";
        let result = remove_tag_block_ci(input, "think");
        assert_eq!(result, "beforeorphan content after");
    }

    #[test]
    fn remove_tag_tokens_strips_stray_tags() {
        let input = "text<think>more</think>end";
        assert_eq!(remove_tag_tokens_ci(input, "think"), "textmoreend");
    }

    #[test]
    fn unwrap_tag_preserves_content() {
        let input = "<user_query>hello world</user_query>";
        assert_eq!(unwrap_tag_ci(input, "user_query"), "hello world");
    }

    #[test]
    fn unwrap_tag_malformed_no_closing_bracket() {
        let input = "<user_query<user_query hello";
        let result = unwrap_tag_ci(input, "user_query");
        assert!(!result.is_empty()); // must not infinite loop
    }

    #[test]
    fn is_timestamp_detects_valid() {
        assert!(is_timestamp_line("12:34:56"));
        assert!(is_timestamp_line("1:00:00"));
    }

    #[test]
    fn is_timestamp_rejects_invalid() {
        assert!(!is_timestamp_line("hello"));
        assert!(!is_timestamp_line("12:34"));
    }
}
