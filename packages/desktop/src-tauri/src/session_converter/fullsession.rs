use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::reconciler::session_tool::{classify_raw_tool_call, ToolClassificationHints};
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::session_update::{tool_call_status_from_str, SkillMeta, ToolCallData};
use crate::acp::transcript_projection::{CanonicalTranscriptEvent, CanonicalTranscriptEventKind};
use crate::session_jsonl::display_names::format_model_display_name;
use crate::session_jsonl::types::{
    ContentBlock, FullSession, QuestionAnswer, StoredAssistantChunk, StoredAssistantMessage,
    StoredContentBlock, StoredEntry, StoredUserMessage,
};
use std::collections::{HashMap, HashSet};

use super::calculate_todo_timing;
use crate::session_converter::transcript_events::materialize_canonical_transcript_events;

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

pub(crate) fn convert_full_session_to_provider_owned_snapshot_with_agent(
    session: &FullSession,
    agent_type: AgentType,
) -> ProviderOwnedSessionSnapshot {
    convert_full_session_impl(session, agent_type)
}

fn convert_full_session_impl(
    session: &FullSession,
    agent_type: AgentType,
) -> ProviderOwnedSessionSnapshot {
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
                tool_results.insert(normalize_tool_call_id(tool_use_id), content.clone());
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
                skill_metas.insert(normalize_tool_call_id(tool_use_id), meta);
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

    // Fourth pass: provider rows become canonical transcript events first.
    // Display entries are only a projection of those canonical events.
    let transcript_events = materialize_canonical_transcript_events(session, agent_type);
    entries.extend(project_canonical_events_to_entries(
        &transcript_events,
        &tool_results,
        &skill_metas,
        &question_answers,
        agent_type,
    ));

    // Fifth pass: deduplicate entries by ID (Cursor stores tool calls redundantly
    // across multiple blobs, producing duplicate ToolCall entries with the same toolCallId).
    let mut seen_ids = HashSet::new();
    entries.retain(|entry| {
        let id = match entry {
            StoredEntry::ToolCall { id, .. } => id.as_str(),
            StoredEntry::Assistant { id, .. } => id.as_str(),
            StoredEntry::User { id, .. } => id.as_str(),
            StoredEntry::Error { id, .. } => id.as_str(),
        };
        seen_ids.insert(id.to_string())
    });

    // Sixth pass: calculate todo timing from state transitions
    calculate_todo_timing(&mut entries);

    let thread_snapshot = SessionThreadSnapshot {
        entries,
        title: session.title.clone(),
        created_at: session.created_at.clone(),
        current_mode_id: None,
    };

    ProviderOwnedSessionSnapshot::with_canonical_transcript_events(
        thread_snapshot,
        transcript_events,
    )
}

fn is_claude_local_command_message(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.contains("<command-name>")
        || trimmed.contains("<command-message>")
        || trimmed.contains("<local-command-stdout>")
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

fn project_canonical_events_to_entries(
    events: &[CanonicalTranscriptEvent],
    tool_results: &HashMap<String, String>,
    skill_metas: &HashMap<String, SkillMeta>,
    question_answers: &HashMap<String, QuestionAnswer>,
    agent_type: AgentType,
) -> Vec<StoredEntry> {
    let mut entries = Vec::new();
    let mut event_index = 0;

    while event_index < events.len() {
        let event = &events[event_index];
        match &event.kind {
            CanonicalTranscriptEventKind::UserText { .. } => {
                let (entry, next_index) = project_user_event_group(events, event_index);
                if let Some(user_entry) = entry {
                    entries.push(user_entry);
                }
                event_index = next_index;
            }
            CanonicalTranscriptEventKind::AssistantText { .. }
            | CanonicalTranscriptEventKind::AssistantThought { .. } => {
                let (entry, next_index) = project_assistant_event_group(events, event_index);
                entries.push(entry);
                event_index = next_index;
            }
            CanonicalTranscriptEventKind::AssistantError { text, error } => {
                entries.push(project_assistant_error_event(event, text, error));
                event_index += 1;
            }
            CanonicalTranscriptEventKind::ToolUse {
                tool_call_id,
                name,
                input,
            } => {
                entries.push(project_tool_event(
                    event,
                    tool_call_id,
                    name,
                    input,
                    tool_results,
                    skill_metas,
                    question_answers,
                    agent_type,
                ));
                event_index += 1;
            }
        }
    }

    entries
}

fn project_user_event_group(
    events: &[CanonicalTranscriptEvent],
    start_index: usize,
) -> (Option<StoredEntry>, usize) {
    let first = &events[start_index];
    let mut text_content = String::new();
    let mut chunks = Vec::new();
    let mut index = start_index;

    while index < events.len() {
        let event = &events[index];
        if event.display_id != first.display_id {
            break;
        }
        let CanonicalTranscriptEventKind::UserText { text } = &event.kind else {
            break;
        };

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
        index += 1;
    }

    if text_content.is_empty() || is_claude_local_command_message(&text_content) {
        return (None, index);
    }

    (
        Some(StoredEntry::User {
            id: first.display_id.clone(),
            message: StoredUserMessage {
                id: Some(first.display_id.clone()),
                content: StoredContentBlock {
                    block_type: "text".to_string(),
                    text: Some(text_content),
                },
                chunks,
                sent_at: Some(first.timestamp.clone()),
            },
            timestamp: Some(first.timestamp.clone()),
        }),
        index,
    )
}

fn project_assistant_event_group(
    events: &[CanonicalTranscriptEvent],
    start_index: usize,
) -> (StoredEntry, usize) {
    let first = &events[start_index];
    let mut chunks = Vec::new();
    let mut index = start_index;

    while index < events.len() {
        let event = &events[index];
        if event.display_id != first.display_id {
            break;
        }

        match &event.kind {
            CanonicalTranscriptEventKind::AssistantText { text } => {
                chunks.push(StoredAssistantChunk {
                    chunk_type: "message".to_string(),
                    block: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some(text.clone()),
                    },
                });
            }
            CanonicalTranscriptEventKind::AssistantThought { text } => {
                chunks.push(StoredAssistantChunk {
                    chunk_type: "thought".to_string(),
                    block: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some(text.clone()),
                    },
                });
            }
            CanonicalTranscriptEventKind::UserText { .. }
            | CanonicalTranscriptEventKind::AssistantError { .. }
            | CanonicalTranscriptEventKind::ToolUse { .. } => break,
        }

        index += 1;
    }

    (
        StoredEntry::Assistant {
            id: first.display_id.clone(),
            message: StoredAssistantMessage {
                chunks,
                model: first.model.clone(),
                display_model: first.model.as_ref().map(|m| format_model_display_name(m)),
                received_at: Some(first.timestamp.clone()),
            },
            timestamp: Some(first.timestamp.clone()),
        },
        index,
    )
}

fn project_assistant_error_event(
    event: &CanonicalTranscriptEvent,
    text: &str,
    error: &crate::cc_sdk::AssistantMessageError,
) -> StoredEntry {
    let content = if text.trim().is_empty() {
        format!("Claude provider error: {:?}", error)
    } else {
        text.to_string()
    };
    StoredEntry::Error {
        id: event.display_id.clone(),
        message: crate::session_jsonl::types::StoredErrorMessage {
            code: super::extract_api_error_status_code(&content).map(str::to_string),
            kind: super::assistant_error_kind(error),
            source: Some(crate::acp::session_update::TurnErrorSource::Transport),
            content,
        },
        timestamp: Some(event.timestamp.clone()),
    }
}

fn project_tool_event(
    event: &CanonicalTranscriptEvent,
    tool_call_id: &str,
    name: &str,
    input: &serde_json::Value,
    tool_results: &HashMap<String, String>,
    skill_metas: &HashMap<String, SkillMeta>,
    question_answers: &HashMap<String, QuestionAnswer>,
    agent_type: AgentType,
) -> StoredEntry {
    let normalized_id = normalize_tool_call_id(tool_call_id);
    let result = tool_results.get(&normalized_id).cloned();
    let status = if result.is_some() {
        "completed"
    } else {
        "pending"
    };
    let skill_meta = if name == "Skill" {
        skill_metas.get(&normalized_id).cloned()
    } else {
        None
    };
    let question_answer = if is_question_tool(name) {
        question_answers.get(&event.provider_row_id).cloned()
    } else {
        None
    };
    let parser = get_parser(agent_type);
    let classified = classify_raw_tool_call(
        parser,
        &normalized_id,
        input,
        ToolClassificationHints {
            name: None,
            title: Some(name),
            kind: Some(parser.detect_tool_kind(name)),
            kind_hint: None,
            locations: None,
        },
    );

    StoredEntry::ToolCall {
        id: normalized_id.clone(),
        message: ToolCallData {
            id: normalized_id,
            name: classified.name.clone(),
            title: Some(classified.name.clone()),
            status: tool_call_status_from_str(status),
            result: result.map(serde_json::Value::String),
            kind: Some(classified.kind),
            arguments: classified.arguments,
            diagnostic_input: Some(input.clone()),
            skill_meta,
            locations: None,
            normalized_questions: classified.normalized_questions,
            normalized_todos: classified.normalized_todos,
            normalized_todo_update: classified.normalized_todo_update,
            parent_tool_use_id: None,
            task_children: None,
            question_answer,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        timestamp: Some(event.timestamp.clone()),
    }
}
