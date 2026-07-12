const STANDARD_CONTEXT_WINDOW: u64 = 200_000;
const EXTENDED_CONTEXT_WINDOW: u64 = 1_000_000;

/// Resolve Claude Code's capability-bearing selection identity.
///
/// Verified against Claude Code 2.1.207 (build bc512d56332530b2be3f5079e29ec17aa20b8553)
/// on 2026-07-12. Keep this table explicit: provider aliases and defaults can change.
pub(crate) fn context_window_for_selection(selection_id: &str) -> Option<u64> {
    let normalized = selection_id.trim().to_ascii_lowercase();
    let base = normalized.strip_suffix("[1m]").unwrap_or(&normalized);
    let recognized_alias = matches!(base, "fable" | "opus" | "sonnet" | "haiku");
    let recognized_claude_id = base.starts_with("claude-")
        && (base == "claude-fable-5"
            || base
                .split('-')
                .any(|part| matches!(part, "opus" | "sonnet" | "haiku")));
    let recognized = recognized_alias || recognized_claude_id;

    if !recognized {
        return None;
    }
    if normalized.ends_with("[1m]") || matches!(base, "fable" | "claude-fable-5") {
        return Some(EXTENDED_CONTEXT_WINDOW);
    }

    Some(STANDARD_CONTEXT_WINDOW)
}

#[cfg(test)]
mod tests {
    use super::context_window_for_selection;

    #[test]
    fn resolves_claude_code_context_windows_from_selection_identity() {
        let cases = [
            ("fable", Some(1_000_000)),
            ("claude-fable-5[1m]", Some(1_000_000)),
            ("opus[1m]", Some(1_000_000)),
            ("claude-opus-4-8", Some(200_000)),
            ("claude-haiku-4-5-20251001", Some(200_000)),
            ("claude-custom-preview", None),
            ("custom-opus-preview", None),
            ("custom-model", None),
        ];

        for (selection_id, expected) in cases {
            assert_eq!(
                context_window_for_selection(selection_id),
                expected,
                "selection {selection_id}"
            );
        }
    }
}
