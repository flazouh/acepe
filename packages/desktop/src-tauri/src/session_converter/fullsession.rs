use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::session_update::{
    parse_normalized_questions, parse_normalized_todos, tool_call_status_from_str, SkillMeta,
    ToolCallData,
};
use crate::session_jsonl::display_names::format_model_display_name;
use crate::session_jsonl::types::{
    ContentBlock, ConvertedSession, FullSession, OrderedMessage, QuestionAnswer,
    StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    StoredUserMessage,
};
use std::collections::{HashMap, HashSet};

use super::{calculate_todo_timing, parse_tool_arguments_for_agent};

pub(crate) fn parse_skill_meta_from_content(content: &str) -> SkillMeta {
    let mut file_path: Option<String> = None;
    let mut description: Option<String> = None;

    // Extract file path from "Base directory for this skill: {path}"
    for line in content.lines() {
        if let Some(path) = line.strip_prefix("Base directory for this skill: ") {
            file_path = Some(path.trim().to_string());
            break;
        }
    }

    // Extract description from YAML front matter or "description:" line
    let mut in_yaml_block = false;
    for line in content.lines() {
        let trimmed = line.trim();

        // Check for YAML front matter start
        if trimmed == "---" {
            in_yaml_block = !in_yaml_block;
            continue;
        }

        // Look for description field
        if let Some(desc) = trimmed.strip_prefix("description:") {
            let desc = desc.trim();
            if !desc.is_empty() {
                description = Some(desc.to_string());
                break;
            }
        }
    }

    // If no description found in front matter, try to get first paragraph after "---" block
    if description.is_none() {
        let mut yaml_marker_count = 0;
        let mut paragraph_lines: Vec<&str> = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();

            if trimmed == "---" {
                yaml_marker_count += 1;
                continue;
            }

            // Only collect content after the second "---" marker (end of front matter)
            if yaml_marker_count >= 2 {
                // Skip empty lines and headers at the start
                if trimmed.is_empty()
                    || trimmed.starts_with('#')
                    || trimmed.starts_with("Base directory")
                {
                    if !paragraph_lines.is_empty() {
                        break; // End of paragraph
                    }
                    continue;
                }

                paragraph_lines.push(trimmed);

                // Limit to first 200 characters
                let current_len: usize = paragraph_lines.iter().map(|l| l.len()).sum();
                if current_len > 200 {
                    break;
                }
            }
        }

        if !paragraph_lines.is_empty() {
            let desc = paragraph_lines.join(" ");
            // Truncate to 200 chars and add ellipsis if needed
            if desc.len() > 200 {
                description = Some(format!("{}...", &desc[..197]));
            } else {
                description = Some(desc);
            }
        }
    }

    SkillMeta {
        description,
        file_path,
    }
}

pub(crate) fn convert_full_session_to_entries(session: &FullSession) -> ConvertedSession {
    convert_full_session_to_entries_with_agent(session, AgentType::ClaudeCode)
}

pub(crate) fn convert_full_session_to_entries_with_agent(
    session: &FullSession,
    agent_type: AgentType,
) -> ConvertedSession {
    let mut entries: Vec<StoredEntry> = Vec::new();

    // First pass: collect tool results from user messages
    let mut tool_results: HashMap<String, String> = HashMap::new();
    for msg in &session.messages {
        if msg.is_meta || msg.role != "user" {
            continue;
        }
        for block in &msg.content_blocks {
            if let ContentBlock::ToolResult {
                tool_use_id,
                content,
            } = block
            {
                tool_results.insert(tool_use_id.clone(), content.clone());
            }
        }
    }

    // Second pass: collect skill meta content from meta messages
    // Maps tool_use_id -> SkillMeta
    let mut skill_metas: HashMap<String, SkillMeta> = HashMap::new();
    for msg in &session.messages {
        if !msg.is_meta {
            continue;
        }

        // Check if this meta message is linked to a tool call
        if let Some(tool_use_id) = &msg.source_tool_use_id {
            // Extract text content from the message
            let mut content = String::new();
            for block in &msg.content_blocks {
                if let ContentBlock::Text { text } = block {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str(text);
                }
            }

            if !content.is_empty() {
                let meta = parse_skill_meta_from_content(&content);
                skill_metas.insert(tool_use_id.clone(), meta);
            }
        }
    }

    // Third pass: collect question answers from user messages with toolUseResult
    // Maps source_tool_assistant_uuid -> QuestionAnswer
    let mut question_answers: HashMap<String, QuestionAnswer> = HashMap::new();
    for msg in &session.messages {
        if msg.is_meta || msg.role != "user" {
            continue;
        }

        // Check if this message has a toolUseResult with question answer data
        if let (Some(tool_use_result), Some(source_uuid)) =
            (&msg.tool_use_result, &msg.source_tool_assistant_uuid)
        {
            if let Some(qa) = parse_question_answer(tool_use_result) {
                question_answers.insert(source_uuid.clone(), qa);
            }
        }
    }

    // Fourth pass: convert messages to entries
    for msg in &session.messages {
        if msg.is_meta {
            continue;
        }

        match msg.role.as_str() {
            "user" => {
                if let Some(entry) = convert_user_message(msg) {
                    entries.push(entry);
                }
            }
            "assistant" => {
                let (assistant_entry, tool_entries) = convert_assistant_message(
                    msg,
                    &tool_results,
                    &skill_metas,
                    &question_answers,
                    agent_type,
                );
                if let Some(entry) = assistant_entry {
                    entries.push(entry);
                }
                entries.extend(tool_entries);
            }
            _ => {}
        }
    }

    // Fifth pass: deduplicate entries by ID (Cursor stores tool calls redundantly
    // across multiple blobs, producing duplicate ToolCall entries with the same toolCallId).
    let mut seen_ids = HashSet::new();
    entries.retain(|entry| {
        let id = match entry {
            StoredEntry::ToolCall { id, .. } => id.as_str(),
            StoredEntry::Assistant { id, .. } => id.as_str(),
            StoredEntry::User { id, .. } => id.as_str(),
        };
        seen_ids.insert(id.to_string())
    });

    // Sixth pass: calculate todo timing from state transitions
    calculate_todo_timing(&mut entries);

    ConvertedSession {
        entries,
        stats: session.stats.clone(),
        title: session.title.clone(),
        created_at: session.created_at.clone(),
    }
}

/// Convert a user message to a StoredEntry.
fn convert_user_message(msg: &OrderedMessage) -> Option<StoredEntry> {
    // Find text content, skip tool results
    let mut text_content = String::new();
    let mut chunks = Vec::new();

    for block in &msg.content_blocks {
        match block {
            ContentBlock::Text { text } => {
                if !text.trim().is_empty() {
                    if text_content.is_empty() {
                        text_content = text.clone();
                    } else {
                        text_content.push('\n');
                        text_content.push_str(text);
                    }
                    chunks.push(StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some(text.clone()),
                    });
                }
            }
            ContentBlock::ToolResult { .. } => {
                // Skip tool results in user message display
            }
            _ => {}
        }
    }

    if text_content.is_empty() {
        return None;
    }

    Some(StoredEntry::User {
        id: msg.uuid.clone(),
        message: StoredUserMessage {
            id: Some(msg.uuid.clone()),
            content: StoredContentBlock {
                block_type: "text".to_string(),
                text: Some(text_content),
            },
            chunks,
            sent_at: Some(msg.timestamp.clone()),
        },
        timestamp: Some(msg.timestamp.clone()),
    })
}

/// Check if a tool name is a question tool.
fn is_question_tool(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(lower.as_str(), "askuserquestion" | "askuser" | "question")
}

/// Parse question answer data from toolUseResult JSON.
///
/// Expected format:
/// ```json
/// {
///   "questions": [{ "question": "...", "header": "...", "options": [...], "multiSelect": false }],
///   "answers": { "What is your question?": "Selected answer" }
/// }
/// ```
fn parse_question_answer(tool_use_result: &serde_json::Value) -> Option<QuestionAnswer> {
    use crate::acp::session_update::QuestionItem;

    // Extract questions array
    let questions_value = tool_use_result.get("questions")?;
    let questions_array = questions_value.as_array()?;

    let mut questions = Vec::new();
    for q in questions_array {
        let question = q.get("question")?.as_str()?.to_string();
        let header = q
            .get("header")
            .and_then(|h| h.as_str())
            .unwrap_or("")
            .to_string();
        let multi_select = q
            .get("multiSelect")
            .and_then(|m| m.as_bool())
            .unwrap_or(false);

        let mut options = Vec::new();
        if let Some(opts) = q.get("options").and_then(|o| o.as_array()) {
            for opt in opts {
                let label = opt
                    .get("label")
                    .and_then(|l| l.as_str())
                    .unwrap_or("")
                    .to_string();
                let description = opt
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string();
                options.push(crate::acp::session_update::QuestionOption { label, description });
            }
        }

        questions.push(QuestionItem {
            question,
            header,
            options,
            multi_select,
        });
    }

    // Extract answers map
    let answers_value = tool_use_result.get("answers")?;
    let answers_obj = answers_value.as_object()?;

    let mut answers = HashMap::new();
    for (key, value) in answers_obj {
        answers.insert(key.clone(), value.clone());
    }

    if questions.is_empty() || answers.is_empty() {
        return None;
    }

    Some(QuestionAnswer { questions, answers })
}

/// Convert an assistant message to StoredEntry plus tool call entries.
fn convert_assistant_message(
    msg: &OrderedMessage,
    tool_results: &HashMap<String, String>,
    skill_metas: &HashMap<String, SkillMeta>,
    question_answers: &HashMap<String, QuestionAnswer>,
    agent_type: AgentType,
) -> (Option<StoredEntry>, Vec<StoredEntry>) {
    let mut chunks: Vec<StoredAssistantChunk> = Vec::new();
    let mut tool_entries: Vec<StoredEntry> = Vec::new();

    for block in &msg.content_blocks {
        match block {
            ContentBlock::Text { text } => {
                if !text.trim().is_empty() {
                    chunks.push(StoredAssistantChunk {
                        chunk_type: "message".to_string(),
                        block: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some(text.clone()),
                        },
                    });
                }
            }
            ContentBlock::Thinking { thinking, .. } => {
                if !thinking.trim().is_empty() {
                    chunks.push(StoredAssistantChunk {
                        chunk_type: "thought".to_string(),
                        block: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some(thinking.clone()),
                        },
                    });
                }
            }
            ContentBlock::ToolUse { id, name, input } => {
                let result = tool_results.get(id).cloned();
                let status = if result.is_some() {
                    "completed"
                } else {
                    "pending"
                };

                // Get skill meta if this is a Skill tool call
                let skill_meta = if name == "Skill" {
                    skill_metas.get(id).cloned()
                } else {
                    None
                };

                // Get question answer if this is a question tool call
                // The question_answers map is keyed by the assistant message UUID
                let question_answer = if is_question_tool(name) {
                    question_answers.get(&msg.uuid).cloned()
                } else {
                    None
                };

                let parser = get_parser(agent_type);
                let kind = parser.detect_tool_kind(name);
                let display_name = crate::acp::parsers::kind::display_name_for_tool(kind, name);
                let normalized_questions = parse_normalized_questions(name, input, agent_type);
                let normalized_todos = parse_normalized_todos(name, input, agent_type);
                tool_entries.push(StoredEntry::ToolCall {
                    id: id.clone(),
                    message: ToolCallData {
                        id: id.clone(),
                        name: display_name.clone(),
                        title: Some(display_name.clone()),
                        status: tool_call_status_from_str(status),
                        result: result.map(serde_json::Value::String),
                        kind: Some(kind),
                        arguments: parse_tool_arguments_for_agent(agent_type, name, input, kind),
                        skill_meta,
                        locations: None,
                        normalized_questions,
                        normalized_todos,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer,
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    },
                    timestamp: Some(msg.timestamp.clone()),
                });
            }
            ContentBlock::ToolResult { .. } => {
                // Tool results are handled when processing tool_use
            }
            ContentBlock::CodeAttachment {
                path,
                lines,
                content,
            } => {
                // Format code attachment as a text block with file info
                let header = match lines {
                    Some(l) => format!("File: {} (lines {})", path, l),
                    None => format!("File: {}", path),
                };
                chunks.push(StoredAssistantChunk {
                    chunk_type: "message".to_string(),
                    block: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some(format!("{}\n```\n{}\n```", header, content)),
                    },
                });
            }
        }
    }

    let assistant_entry = if !chunks.is_empty() {
        Some(StoredEntry::Assistant {
            id: msg.uuid.clone(),
            message: StoredAssistantMessage {
                chunks,
                model: msg.model.clone(),
                display_model: msg.model.as_ref().map(|m| format_model_display_name(m)),
                received_at: Some(msg.timestamp.clone()),
            },
            timestamp: Some(msg.timestamp.clone()),
        })
    } else {
        None
    };

    (assistant_entry, tool_entries)
}
