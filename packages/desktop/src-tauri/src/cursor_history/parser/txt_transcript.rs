use super::{CodeAttachment, CursorTranscriptMessage};
use crate::history::tag_utils::{
    is_timestamp_line, remove_tag_block_ci, remove_tag_tokens_ci, unwrap_tag_ci,
};

pub(super) fn extract_title_from_messages(messages: &[CursorTranscriptMessage]) -> Option<String> {
    for msg in messages {
        if msg.role != "user" {
            continue;
        }

        // Extract text, handling the <user_query> wrapper if present
        let text = extract_user_text(msg.text.as_deref().unwrap_or(""));
        let trimmed = text.trim();

        if trimmed.is_empty() {
            continue;
        }

        // Skip command messages
        if is_command_message(trimmed) {
            continue;
        }

        // Truncate long titles
        return Some(truncate_title(trimmed));
    }

    None
}

/// Extract code attachments from `<attached_files>` blocks.
fn extract_attachments(text: &str) -> Vec<CodeAttachment> {
    let mut attachments = Vec::new();

    // Find all <code_selection> blocks within <attached_files>
    let attached_start = text.find("<attached_files>");
    let attached_end = text.find("</attached_files>");

    if attached_start.is_none() || attached_end.is_none() {
        return attachments;
    }

    let attached_content = &text[attached_start.unwrap()..attached_end.unwrap()];

    // Parse each <code_selection> block
    let mut search_start = 0;
    while let Some(start) = attached_content[search_start..].find("<code_selection") {
        let abs_start = search_start + start;

        // Find the end of the opening tag
        let tag_end = match attached_content[abs_start..].find('>') {
            Some(pos) => abs_start + pos,
            None => break,
        };

        // Find the closing tag
        let content_end = match attached_content[tag_end..].find("</code_selection>") {
            Some(pos) => tag_end + pos,
            None => break,
        };

        // Extract the opening tag to parse attributes
        let opening_tag = &attached_content[abs_start..=tag_end];

        // Parse path attribute
        let path = extract_attribute(opening_tag, "path").unwrap_or_default();

        // Parse lines attribute
        let lines = extract_attribute(opening_tag, "lines");

        // Extract content between tags
        let content = attached_content[tag_end + 1..content_end]
            .trim()
            .to_string();

        if !path.is_empty() {
            attachments.push(CodeAttachment {
                path,
                lines,
                content,
            });
        }

        search_start = content_end + "</code_selection>".len();
    }

    attachments
}

/// Extract an attribute value from an XML-like tag.
fn extract_attribute(tag: &str, attr_name: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr_name);
    if let Some(start) = tag.find(&pattern) {
        let value_start = start + pattern.len();
        if let Some(end) = tag[value_start..].find('"') {
            return Some(tag[value_start..value_start + end].to_string());
        }
    }
    None
}

/// Extract user text and attachments from a user message.
/// Returns (text, attachments).
pub(super) fn extract_user_content(text: &str) -> (String, Option<Vec<CodeAttachment>>) {
    let attachments = extract_attachments(text);
    let user_text = extract_user_text(text);

    let attachments_opt = if attachments.is_empty() {
        None
    } else {
        Some(attachments)
    };

    (user_text, attachments_opt)
}

/// Extract user text, removing XML wrappers like <user_query>.
pub(super) fn extract_user_text(text: &str) -> String {
    let mut result = text.to_string();

    // Remove <user_query>...</user_query> wrapper
    if let Some(start) = result.find("<user_query>") {
        if let Some(end) = result.find("</user_query>") {
            let inner_start = start + "<user_query>".len();
            if inner_start < end {
                result = result[inner_start..end].to_string();
            }
        }
    }

    // Remove <user_info>...</user_info> sections
    while let Some(start) = result.find("<user_info>") {
        if let Some(end) = result.find("</user_info>") {
            let before = &result[..start];
            let after = &result[end + "</user_info>".len()..];
            result = format!("{}{}", before, after);
        } else {
            break;
        }
    }

    result.trim().to_string()
}

/// Check if content looks like a command.
pub(super) fn is_command_message(content: &str) -> bool {
    let trimmed = content.trim();
    trimmed.starts_with('/')
        || trimmed.contains("<command-name>")
        || trimmed.contains("<command-message>")
}

/// Truncate a title to a reasonable length.
pub(super) fn truncate_title(title: &str) -> String {
    // Take first line only
    let first_line = title.lines().next().unwrap_or(title);
    let trimmed = first_line.trim();

    // Use char_indices to find a valid UTF-8 boundary for truncation
    if trimmed.chars().count() > 100 {
        let truncated: String = trimmed.chars().take(100).collect();
        format!("{}...", truncated)
    } else {
        trimmed.to_string()
    }
}

/// Sanitize Cursor assistant text by removing system/metadata tags and timestamps.
pub(super) fn sanitize_cursor_assistant_text(text: &str) -> String {
    let mut result = text.replace("\r\n", "\n").replace('\r', "\n");

    // Unwrap user_query tags: keep inner text, strip the tags themselves.
    // Must happen before blocked-tag removal so the content survives.
    result = unwrap_tag_ci(&result, "user_query");

    let blocked_tags = [
        "think",
        "system_reminder",
        "user_info",
        "git_status",
        "agent_transcripts",
        "agent_skills",
        "rules",
        "always_applied_workspace_rules",
        "always_applied_workspace_rule",
        "environment_context",
        "instructions",
    ];

    for tag in blocked_tags {
        result = remove_tag_block_ci(&result, tag);
        result = remove_tag_tokens_ci(&result, tag);
    }

    let lines = result
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !is_timestamp_line(line))
        .collect::<Vec<_>>();

    lines.join("\n").trim().to_string()
}

/// Check if a line starts an assistant message block.
/// Supports both "assistant:" (current Cursor format) and "A:" (legacy format).
fn is_assistant_marker(line: &str) -> bool {
    line.starts_with("assistant:") || line.starts_with("A:")
}

/// Parse a text-format transcript file into CursorTranscriptMessage format.
///
/// Cursor stores some transcripts as .txt files with a human-readable format:
/// ```text
/// user:
/// <user_query>
/// message here
/// </user_query>
///
/// assistant:    # or "A:" for legacy format
/// <think>
/// reasoning here
/// </think>
/// Response text here
///
/// [Tool call] tool_name
///   param1: value1
///
/// [Tool result] tool_name
/// ```
pub(crate) fn parse_txt_transcript_content(content: &str) -> Vec<CursorTranscriptMessage> {
    let mut messages = Vec::new();

    if content.trim().is_empty() {
        return messages;
    }

    // State machine for parsing
    enum State {
        Initial,
        InUserQuery,
        InAssistant,
        InToolCall,
        InToolResult,
    }

    let mut state = State::Initial;
    let mut current_text = String::new();
    let mut current_role = String::new();

    for line in content.lines() {
        match &state {
            State::Initial => {
                if line.starts_with("user:") {
                    state = State::InUserQuery;
                    current_role = "user".to_string();
                    current_text.clear();
                } else if is_assistant_marker(line) {
                    state = State::InAssistant;
                    current_role = "assistant".to_string();
                    current_text.clear();
                } else if line.starts_with("[Tool call]") {
                    state = State::InToolCall;
                    current_role = "assistant".to_string();
                    current_text = line.to_string();
                } else if line.starts_with("[Tool result]") {
                    state = State::InToolResult;
                    current_role = "tool".to_string();
                    current_text = line.to_string();
                }
            }
            State::InUserQuery => {
                if is_assistant_marker(line) {
                    // Flush user message
                    let (text, attachments) = extract_user_content(&current_text);
                    if !text.trim().is_empty() || attachments.is_some() {
                        messages.push(CursorTranscriptMessage {
                            role: current_role.clone(),
                            text: if text.trim().is_empty() {
                                None
                            } else {
                                Some(text)
                            },
                            attachments,
                        });
                    }
                    state = State::InAssistant;
                    current_role = "assistant".to_string();
                    current_text.clear();
                } else if line.starts_with("[Tool call]") {
                    // Flush user message
                    let (text, attachments) = extract_user_content(&current_text);
                    if !text.trim().is_empty() || attachments.is_some() {
                        messages.push(CursorTranscriptMessage {
                            role: current_role.clone(),
                            text: if text.trim().is_empty() {
                                None
                            } else {
                                Some(text)
                            },
                            attachments,
                        });
                    }
                    state = State::InToolCall;
                    current_role = "assistant".to_string();
                    current_text = line.to_string();
                } else {
                    current_text.push_str(line);
                    current_text.push('\n');
                }
            }
            State::InAssistant => {
                if line.starts_with("user:") {
                    // Flush assistant message
                    if !current_text.trim().is_empty() {
                        messages.push(CursorTranscriptMessage {
                            role: current_role.clone(),
                            text: Some(current_text.trim().to_string()),
                            attachments: None,
                        });
                    }
                    state = State::InUserQuery;
                    current_role = "user".to_string();
                    current_text.clear();
                } else if is_assistant_marker(line) {
                    // Flush current assistant message and start new one
                    if !current_text.trim().is_empty() {
                        messages.push(CursorTranscriptMessage {
                            role: current_role.clone(),
                            text: Some(current_text.trim().to_string()),
                            attachments: None,
                        });
                    }
                    current_text.clear();
                } else if line.starts_with("[Tool call]") {
                    // Flush assistant message
                    if !current_text.trim().is_empty() {
                        messages.push(CursorTranscriptMessage {
                            role: current_role.clone(),
                            text: Some(current_text.trim().to_string()),
                            attachments: None,
                        });
                    }
                    state = State::InToolCall;
                    current_role = "assistant".to_string();
                    current_text = line.to_string();
                } else if line.starts_with("[Tool result]") {
                    // Flush assistant message
                    if !current_text.trim().is_empty() {
                        messages.push(CursorTranscriptMessage {
                            role: current_role.clone(),
                            text: Some(current_text.trim().to_string()),
                            attachments: None,
                        });
                    }
                    state = State::InToolResult;
                    current_role = "tool".to_string();
                    current_text = line.to_string();
                } else {
                    current_text.push_str(line);
                    current_text.push('\n');
                }
            }
            State::InToolCall => {
                if line.starts_with("user:") {
                    // Tool call messages are informational, skip for now
                    state = State::InUserQuery;
                    current_role = "user".to_string();
                    current_text.clear();
                } else if is_assistant_marker(line) {
                    state = State::InAssistant;
                    current_role = "assistant".to_string();
                    current_text.clear();
                } else if line.starts_with("[Tool result]") {
                    state = State::InToolResult;
                    current_role = "tool".to_string();
                    current_text = line.to_string();
                } else if line.starts_with("[Tool call]") {
                    // Another tool call, continue
                    current_text = line.to_string();
                }
                // Ignore tool call params for now
            }
            State::InToolResult => {
                if line.starts_with("user:") {
                    state = State::InUserQuery;
                    current_role = "user".to_string();
                    current_text.clear();
                } else if is_assistant_marker(line) {
                    state = State::InAssistant;
                    current_role = "assistant".to_string();
                    current_text.clear();
                } else if line.starts_with("[Tool call]") {
                    state = State::InToolCall;
                    current_role = "assistant".to_string();
                    current_text = line.to_string();
                } else if line.starts_with("[Tool result]") {
                    // Another tool result
                    current_text = line.to_string();
                }
                // Ignore tool result content for now
            }
        }
    }

    // Flush any remaining content
    match state {
        State::InUserQuery => {
            let (text, attachments) = extract_user_content(&current_text);
            if !text.trim().is_empty() || attachments.is_some() {
                messages.push(CursorTranscriptMessage {
                    role: current_role,
                    text: if text.trim().is_empty() {
                        None
                    } else {
                        Some(text)
                    },
                    attachments,
                });
            }
        }
        State::InAssistant => {
            if !current_text.trim().is_empty() {
                messages.push(CursorTranscriptMessage {
                    role: current_role,
                    text: Some(current_text.trim().to_string()),
                    attachments: None,
                });
            }
        }
        _ => {}
    }

    messages
}

/// Analysis result for transcript parsing coverage.
#[derive(Debug, Clone, Default)]
#[allow(dead_code)] // Used in test_integration.rs
pub(crate) struct ParsingAnalysis {
    /// Total number of lines in the transcript
    pub total_lines: usize,
    /// Lines that contributed to messages
    pub parsed_lines: usize,
    /// Lines that were dropped/ignored
    pub dropped_lines: usize,
    /// Number of user messages extracted
    pub user_message_count: usize,
    /// Number of assistant messages extracted
    pub assistant_message_count: usize,
    /// Number of tool calls extracted
    pub tool_call_count: usize,
    /// Unknown line prefixes encountered (line prefix -> count)
    pub unknown_prefixes: std::collections::HashMap<String, usize>,
    /// Sample of unparsed content (up to 10 examples)
    pub unparsed_samples: Vec<String>,
    /// Lines that look like they might be message markers but weren't recognized
    pub potential_markers: Vec<String>,
}

impl ParsingAnalysis {
    /// Calculate parsing coverage as a percentage
    #[allow(dead_code)] // Used in test_integration.rs
    pub fn coverage_percent(&self) -> f64 {
        if self.total_lines == 0 {
            return 100.0;
        }
        (self.parsed_lines as f64 / self.total_lines as f64) * 100.0
    }

    /// Check if there are any issues detected
    #[allow(dead_code)] // Used in test_integration.rs
    pub fn has_issues(&self) -> bool {
        !self.unknown_prefixes.is_empty()
            || !self.potential_markers.is_empty()
            || self.coverage_percent() < 80.0
    }
}

/// Analyze transcript parsing to detect missing logic.
///
/// This function parses the transcript and tracks what content is being
/// captured vs dropped, identifying patterns that might indicate missing
/// parsing logic.
#[allow(dead_code)] // Used in test_integration.rs
pub(crate) fn analyze_transcript_parsing(content: &str) -> ParsingAnalysis {
    let mut analysis = ParsingAnalysis::default();
    let lines: Vec<&str> = content.lines().collect();
    analysis.total_lines = lines.len();

    // Track state similar to parse_txt_transcript_content
    #[derive(Debug, Clone, PartialEq)]
    enum AnalysisState {
        Initial,
        InUser,
        InAssistant,
        InToolCall,
        InToolResult,
        InThink,
    }

    let mut state = AnalysisState::Initial;
    let mut in_user_query = false;

    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let mut line_contributed = false;

        // Check for state transitions
        if trimmed == "user:" || trimmed.starts_with("user:") {
            state = AnalysisState::InUser;
            line_contributed = true;
        } else if is_assistant_marker(trimmed) {
            state = AnalysisState::InAssistant;
            line_contributed = true;
        } else if trimmed.starts_with("[Tool call]") {
            state = AnalysisState::InToolCall;
            analysis.tool_call_count += 1;
            line_contributed = true;
        } else if trimmed.starts_with("[Tool result]") {
            state = AnalysisState::InToolResult;
            line_contributed = true;
        } else if trimmed == "<think>" {
            state = AnalysisState::InThink;
            line_contributed = true;
        } else if trimmed == "</think>" {
            state = AnalysisState::InAssistant;
            line_contributed = true;
        } else if trimmed == "<user_query>" {
            in_user_query = true;
            line_contributed = true;
        } else if trimmed == "</user_query>" {
            in_user_query = false;
            analysis.user_message_count += 1;
            line_contributed = true;
        } else {
            // Content line - check if it's being captured
            match state {
                AnalysisState::InUser if in_user_query => {
                    line_contributed = true;
                }
                AnalysisState::InAssistant | AnalysisState::InThink => {
                    line_contributed = true;
                }
                AnalysisState::InToolCall | AnalysisState::InToolResult => {
                    line_contributed = true;
                }
                AnalysisState::Initial => {
                    // Lines in initial state that look like they might be markers
                    if !trimmed.is_empty() {
                        // Check for potential unrecognized markers
                        if trimmed.ends_with(':') && trimmed.len() < 20 {
                            let prefix = trimmed.to_string();
                            *analysis.unknown_prefixes.entry(prefix.clone()).or_insert(0) += 1;
                            if analysis.potential_markers.len() < 10 {
                                analysis.potential_markers.push(format!(
                                    "Line {}: {}",
                                    line_num + 1,
                                    trimmed
                                ));
                            }
                        } else if analysis.unparsed_samples.len() < 10 {
                            analysis.unparsed_samples.push(format!(
                                "Line {}: {}",
                                line_num + 1,
                                if trimmed.len() > 80 {
                                    format!("{}...", &trimmed[..80])
                                } else {
                                    trimmed.to_string()
                                }
                            ));
                        }
                    }
                }
                _ => {}
            }
        }

        if line_contributed {
            analysis.parsed_lines += 1;
        } else if !trimmed.is_empty() {
            analysis.dropped_lines += 1;
        }
    }

    // Count assistant messages by re-parsing
    let messages = parse_txt_transcript_content(content);
    analysis.assistant_message_count = messages.iter().filter(|m| m.role == "assistant").count();
    analysis.user_message_count = messages.iter().filter(|m| m.role == "user").count();

    analysis
}
