//! Claude SDK local slash-command XML detection and parsing.
//!
//! Single source of truth for `<command-name>`, `<command-message>`,
//! `<command-args>`, and `<local-command-stdout>` handling.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCommandOutput {
    pub command: String,
    pub message: String,
    pub args: String,
    pub stdout: String,
    pub model_display_name: Option<String>,
    pub model_description: Option<String>,
}

pub fn is_local_command_text(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.starts_with('/')
        || trimmed.contains("<command-name>")
        || trimmed.contains("<command-message>")
        || trimmed.contains("<local-command-stdout>")
}

/// Returns `None` when the text is not a local command payload.
pub fn parse_local_command(text: &str) -> Option<LocalCommandOutput> {
    let trimmed = text.trim();
    if trimmed.is_empty() || !is_local_command_text(trimmed) {
        return None;
    }

    let command = capture_tag(trimmed, "command-name");
    let message = capture_tag(trimmed, "command-message");
    let args = capture_tag(trimmed, "command-args");
    let stdout = capture_tag(trimmed, "local-command-stdout");

    if command.is_none() && message.is_none() && args.is_none() && stdout.is_none() {
        return None;
    }

    let stdout_value = stdout.unwrap_or_default();
    let (model_display_name, model_description) = parse_model_display_from_stdout(&stdout_value);

    Some(LocalCommandOutput {
        command: command.unwrap_or_default(),
        message: message.unwrap_or_default(),
        args: args.unwrap_or_default(),
        stdout: stdout_value,
        model_display_name,
        model_description,
    })
}

fn capture_tag(text: &str, tag: &str) -> Option<String> {
    let value = match tag {
        "command-name" => command_name_regex().captures(text),
        "command-message" => command_message_regex().captures(text),
        "command-args" => command_args_regex().captures(text),
        "local-command-stdout" => local_command_stdout_regex().captures(text),
        _ => return None,
    };
    value
        .and_then(|caps| caps.get(1))
        .map(|capture| capture.as_str().trim().to_string())
        .filter(|capture| !capture.is_empty())
}

fn command_name_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<command-name>(.*?)</command-name>").expect("valid regex"))
}

fn command_message_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?s)<command-message>(.*?)</command-message>").expect("valid regex")
    })
}

fn command_args_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<command-args>(.*?)</command-args>").expect("valid regex"))
}

fn local_command_stdout_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?s)<local-command-stdout>(.*?)</local-command-stdout>").expect("valid regex")
    })
}

fn parse_model_display_from_stdout(stdout: &str) -> (Option<String>, Option<String>) {
    let clean = strip_ansi_codes(stdout);
    if let Some(caps) = model_detail_regex().captures(&clean) {
        return (
            Some(caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()),
            Some(caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default()),
        );
    }
    if let Some(caps) = model_simple_regex().captures(&clean) {
        return (Some(caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default()), None);
    }
    (None, None)
}

fn strip_ansi_codes(value: &str) -> String {
    ansi_regex()
        .replace_all(value, "")
        .trim()
        .to_string()
}

fn model_detail_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)Set model to\s+(\w+)\s*\(([^)]+)\)").expect("valid regex"))
}

fn model_simple_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)Set model to\s+(.+)").expect("valid regex"))
}

fn ansi_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\x1b\[\d+m").expect("valid regex"))
}

#[cfg(test)]
mod tests {
    use super::{is_local_command_text, parse_local_command};

    #[test]
    fn detects_local_command_tags() {
        assert!(is_local_command_text("<command-name>/login</command-name>"));
        assert!(!is_local_command_text("hello"));
    }

    #[test]
    fn parses_header_only_command() {
        let parsed = parse_local_command(
            "<command-name>/login</command-name>\n<command-message>login</command-message>\n<command-args></command-args>",
        )
        .expect("parsed");
        assert_eq!(parsed.command, "/login");
        assert_eq!(parsed.message, "login");
        assert!(parsed.stdout.is_empty());
    }

    #[test]
    fn parses_stdout_only_command() {
        let parsed =
            parse_local_command("<local-command-stdout>Login successful</local-command-stdout>")
                .expect("parsed");
        assert_eq!(parsed.stdout, "Login successful");
    }

    #[test]
    fn parses_model_stdout_metadata() {
        let parsed = parse_local_command(
            "<local-command-stdout>Set model to opus (Opus 4.5 · Most capable)</local-command-stdout>",
        )
        .expect("parsed");
        assert_eq!(parsed.model_display_name.as_deref(), Some("opus"));
        assert_eq!(
            parsed.model_description.as_deref(),
            Some("Opus 4.5 · Most capable")
        );
    }
}
