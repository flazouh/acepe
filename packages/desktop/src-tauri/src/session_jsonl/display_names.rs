//! Display name formatting utilities for tools and models.
//!
//! Converts raw identifiers to user-friendly display names.

/// Format a tool name into a user-friendly display title.
///
/// # Examples
/// ```
/// use acepe_lib::session_jsonl::display_names::format_tool_display_name;
/// assert_eq!(format_tool_display_name("TodoWrite"), "Todo");
/// assert_eq!(format_tool_display_name("WebSearch"), "Search");
/// assert_eq!(format_tool_display_name("Bash"), "Bash");
/// ```
pub fn format_tool_display_name(name: &str) -> String {
    // Strip MCP prefix if present (e.g., "mcp__acp__Read" -> "Read")
    let clean_name = if name.starts_with("mcp__") {
        name.rsplit("__").next().unwrap_or(name)
    } else {
        name
    };

    // Known tool name mappings
    match clean_name {
        "TodoWrite" => "Todo".to_string(),
        "WebSearch" => "Search".to_string(),
        "WebFetch" => "Fetch".to_string(),
        "AskUserQuestion" => "Question".to_string(),
        "Task" => "Agent".to_string(),
        "TaskOutput" => "Agent Output".to_string(),
        "KillShell" => "Kill Shell".to_string(),
        "NotebookEdit" => "Notebook".to_string(),
        "ExitPlanMode" => "Exit Plan".to_string(),
        "CreatePlan" => "Create Plan".to_string(),
        "EnterPlanMode" => "Enter Plan".to_string(),
        // Keep these as-is (already clean)
        "Read" | "Edit" | "Write" | "Bash" | "Glob" | "Grep" | "Skill" => clean_name.to_string(),
        // For unknown tools, split camelCase/PascalCase
        _ => split_pascal_case(clean_name),
    }
}

/// Format a model ID into a user-friendly display name.
///
/// Dynamically parses version from model IDs, making it future-proof for new versions.
///
/// # Examples
/// ```
/// use acepe_lib::session_jsonl::display_names::format_model_display_name;
/// assert_eq!(format_model_display_name("claude-opus-4-5-20251101"), "Opus 4.5");
/// assert_eq!(format_model_display_name("claude-sonnet-4-6-20260514"), "Sonnet 4.6");
/// assert_eq!(format_model_display_name("opus"), "Opus");
/// ```
pub fn format_model_display_name(model_id: &str) -> String {
    let lower = model_id.to_lowercase();

    // Try to parse the model ID dynamically
    if let Some(display_name) = parse_claude_model_id(&lower) {
        return display_name;
    }

    // Fallback: clean up the model ID generically
    // Remove "claude-" prefix and date suffix, then capitalize
    let cleaned = model_id
        .trim_start_matches("claude-")
        .trim_start_matches("claude_");

    // Remove date suffix (e.g., -20251101 or _20251101)
    let without_date = if let Some(idx) = cleaned.rfind(['-', '_']) {
        let suffix = &cleaned[idx + 1..];
        if suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
            &cleaned[..idx]
        } else {
            cleaned
        }
    } else {
        cleaned
    };

    capitalize_words(without_date)
}

/// Split PascalCase into separate words.
/// e.g., "SomeToolName" -> "Some Tool Name"
fn split_pascal_case(s: &str) -> String {
    let mut result = String::new();
    let mut prev_was_lower = false;

    for c in s.chars() {
        if c.is_uppercase() && prev_was_lower {
            result.push(' ');
        }
        result.push(c);
        prev_was_lower = c.is_lowercase();
    }

    result
}

/// Capitalize the first letter of each word.
fn capitalize_words(s: &str) -> String {
    s.split(['-', '_', ' '])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    first.to_uppercase().collect::<String>()
                        + chars.as_str().to_lowercase().as_str()
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Capitalize the first letter of a string.
fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

/// Parse a Claude model ID to extract family and version.
///
/// Handles patterns like:
/// - "claude-sonnet-4-6-20250514" → Some("Sonnet 4.6")
/// - "claude-opus-4-5-20251101" → Some("Opus 4.5")
/// - "sonnet-4-6" → Some("Sonnet 4.6")
/// - "opus" → Some("Opus")
///
/// Returns None if the model ID doesn't match known patterns.
fn parse_claude_model_id(model_id: &str) -> Option<String> {
    // Split by both dash and underscore
    let parts: Vec<&str> = model_id.split(&['-', '_'][..]).collect();

    // Find the model family (opus, sonnet, haiku)
    let family_idx = parts
        .iter()
        .position(|&p| p == "opus" || p == "sonnet" || p == "haiku")?;

    let family = capitalize_first(parts[family_idx]);

    // Extract version numbers after the family name
    let version_parts = &parts[family_idx + 1..];

    // Filter out:
    // 1. Date stamps (8-digit numbers like 20250514)
    // 2. Non-numeric parts
    let version_nums: Vec<&str> = version_parts
        .iter()
        .filter(|s| {
            // Skip date stamps
            if s.len() == 8 && s.chars().all(|c| c.is_ascii_digit()) {
                return false;
            }
            // Only keep numeric parts
            s.chars().all(|c| c.is_ascii_digit())
        })
        .copied()
        .collect();

    // If no version numbers, return just the family name
    if version_nums.is_empty() {
        return Some(family);
    }

    // Format as "Family Major.Minor" or "Family Major.Minor.Patch"
    let version = version_nums.join(".");
    Some(format!("{} {}", family, version))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_tool_display_name() {
        // Known mappings
        assert_eq!(format_tool_display_name("TodoWrite"), "Todo");
        assert_eq!(format_tool_display_name("WebSearch"), "Search");
        assert_eq!(format_tool_display_name("WebFetch"), "Fetch");
        assert_eq!(format_tool_display_name("AskUserQuestion"), "Question");
        assert_eq!(format_tool_display_name("Task"), "Agent");
        assert_eq!(format_tool_display_name("TaskOutput"), "Agent Output");
        assert_eq!(format_tool_display_name("KillShell"), "Kill Shell");
        assert_eq!(format_tool_display_name("NotebookEdit"), "Notebook");
        assert_eq!(format_tool_display_name("ExitPlanMode"), "Exit Plan");
        assert_eq!(format_tool_display_name("EnterPlanMode"), "Enter Plan");

        // Pass-through names
        assert_eq!(format_tool_display_name("Read"), "Read");
        assert_eq!(format_tool_display_name("Edit"), "Edit");
        assert_eq!(format_tool_display_name("Bash"), "Bash");
        assert_eq!(format_tool_display_name("Glob"), "Glob");
        assert_eq!(format_tool_display_name("Grep"), "Grep");

        // MCP prefix stripping
        assert_eq!(format_tool_display_name("mcp__acp__Read"), "Read");
        assert_eq!(
            format_tool_display_name("mcp__server__SomeTool"),
            "Some Tool"
        );

        // PascalCase splitting
        assert_eq!(format_tool_display_name("SomeNewTool"), "Some New Tool");
    }

    #[test]
    fn test_format_model_display_name() {
        // Short names (without version) - should return just the family name
        assert_eq!(format_model_display_name("opus"), "Opus");
        assert_eq!(format_model_display_name("sonnet"), "Sonnet");
        assert_eq!(format_model_display_name("haiku"), "Haiku");

        // Full model IDs with version parsing
        assert_eq!(
            format_model_display_name("claude-opus-4-5-20251101"),
            "Opus 4.5"
        );
        assert_eq!(
            format_model_display_name("claude-sonnet-4-20250514"),
            "Sonnet 4"
        );
        assert_eq!(
            format_model_display_name("claude-haiku-3-5-20241022"),
            "Haiku 3.5"
        );

        // Future versions (the main goal - should work without code changes)
        assert_eq!(
            format_model_display_name("claude-sonnet-4-6-20260101"),
            "Sonnet 4.6"
        );
        assert_eq!(
            format_model_display_name("claude-sonnet-5-0-20260601"),
            "Sonnet 5.0"
        );
        assert_eq!(
            format_model_display_name("claude-opus-5-2-20270101"),
            "Opus 5.2"
        );
        assert_eq!(
            format_model_display_name("claude-haiku-4-0-20260301"),
            "Haiku 4.0"
        );

        // Partial matches (without claude- prefix)
        assert_eq!(format_model_display_name("opus-4-5"), "Opus 4.5");
        assert_eq!(format_model_display_name("sonnet-3-5"), "Sonnet 3.5");
        assert_eq!(format_model_display_name("sonnet-4-6"), "Sonnet 4.6");

        // With underscores instead of dashes
        assert_eq!(
            format_model_display_name("claude_sonnet_4_6_20260101"),
            "Sonnet 4.6"
        );

        // Edge case: version with only major number
        assert_eq!(
            format_model_display_name("claude-sonnet-5-20270101"),
            "Sonnet 5"
        );

        // Edge case: no date suffix
        assert_eq!(format_model_display_name("claude-opus-4-5"), "Opus 4.5");
        assert_eq!(format_model_display_name("claude-sonnet-4-6"), "Sonnet 4.6");
    }

    #[test]
    fn test_split_pascal_case() {
        assert_eq!(split_pascal_case("SomeToolName"), "Some Tool Name");
        // Note: HTTPServer doesn't split because there's no lowercase-to-uppercase transition
        assert_eq!(split_pascal_case("HTTPServer"), "HTTPServer");
        assert_eq!(split_pascal_case("lowercase"), "lowercase");
        assert_eq!(split_pascal_case("ALLCAPS"), "ALLCAPS");
        // Only splits at lowercase-to-uppercase transitions
        assert_eq!(split_pascal_case("MyHTTPHandler"), "My HTTPHandler");
    }

    #[test]
    fn test_capitalize_words() {
        assert_eq!(capitalize_words("hello-world"), "Hello World");
        assert_eq!(capitalize_words("some_test_case"), "Some Test Case");
        assert_eq!(capitalize_words("ALLCAPS"), "Allcaps");
    }

    #[test]
    fn test_parse_claude_model_id() {
        // Full model IDs with versions
        assert_eq!(
            parse_claude_model_id("claude-opus-4-5-20251101"),
            Some("Opus 4.5".to_string())
        );
        assert_eq!(
            parse_claude_model_id("claude-sonnet-4-6-20260101"),
            Some("Sonnet 4.6".to_string())
        );
        assert_eq!(
            parse_claude_model_id("claude-haiku-3-5-20241022"),
            Some("Haiku 3.5".to_string())
        );

        // Without claude prefix
        assert_eq!(
            parse_claude_model_id("opus-4-5"),
            Some("Opus 4.5".to_string())
        );
        assert_eq!(
            parse_claude_model_id("sonnet-4-6"),
            Some("Sonnet 4.6".to_string())
        );

        // With underscores
        assert_eq!(
            parse_claude_model_id("claude_sonnet_4_6_20260101"),
            Some("Sonnet 4.6".to_string())
        );

        // Just family name (no version)
        assert_eq!(parse_claude_model_id("opus"), Some("Opus".to_string()));
        assert_eq!(parse_claude_model_id("sonnet"), Some("Sonnet".to_string()));
        assert_eq!(parse_claude_model_id("haiku"), Some("Haiku".to_string()));

        // Major version only
        assert_eq!(
            parse_claude_model_id("claude-sonnet-5-20270101"),
            Some("Sonnet 5".to_string())
        );

        // Non-Claude models
        assert_eq!(parse_claude_model_id("gpt-4"), None);
        assert_eq!(parse_claude_model_id("gemini-pro"), None);
    }
}
