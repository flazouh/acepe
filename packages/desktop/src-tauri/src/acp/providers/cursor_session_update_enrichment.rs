use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolCallData, ToolCallUpdateData, ToolKind,
};
use crate::acp::tool_call_presentation::{
    merge_tool_arguments, synthesize_locations, synthesize_title, title_is_placeholder,
};
use crate::session_jsonl::types::{ContentBlock, FullSession};
use dashmap::DashMap;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq)]
struct PersistedToolUse {
    name: String,
    input: serde_json::Value,
}

#[derive(Debug, Clone)]
struct SessionToolUseCache {
    store_db_path: PathBuf,
    modified_at: SystemTime,
    tool_uses: HashMap<String, PersistedToolUse>,
}

static CURSOR_TOOL_USE_CACHE: LazyLock<DashMap<String, SessionToolUseCache>> =
    LazyLock::new(DashMap::new);

fn build_persisted_tool_use_index(
    session: &FullSession,
) -> std::collections::HashMap<String, PersistedToolUse> {
    let mut index = std::collections::HashMap::new();

    for message in &session.messages {
        for block in &message.content_blocks {
            if let ContentBlock::ToolUse { id, name, input } = block {
                index.insert(
                    id.clone(),
                    PersistedToolUse {
                        name: name.clone(),
                        input: input.clone(),
                    },
                );
            }
        }
    }

    index
}

fn enrich_tool_call_from_index(
    update: SessionUpdate,
    index: &HashMap<String, PersistedToolUse>,
) -> SessionUpdate {
    match update {
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => SessionUpdate::ToolCall {
            tool_call: enrich_tool_call_data(tool_call, index),
            session_id,
        },
        SessionUpdate::ToolCallUpdate { update, session_id } => SessionUpdate::ToolCallUpdate {
            update: enrich_tool_call_update_data(update, index),
            session_id,
        },
        other => other,
    }
}

pub(crate) async fn enrich_cursor_session_update(update: SessionUpdate) -> SessionUpdate {
    match &update {
        SessionUpdate::TurnComplete { session_id }
        | SessionUpdate::TurnError { session_id, .. } => {
            if let Some(session_id) = session_id {
                CURSOR_TOOL_USE_CACHE.remove(session_id);
            }
            update
        }
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => {
            if !tool_call_needs_enrichment(tool_call) {
                return update;
            }
            let Some(session_id) = session_id.as_deref() else {
                return update;
            };
            let Some(index) =
                load_tool_use_index_for_session(session_id, Some(&tool_call.id)).await
            else {
                return update;
            };
            enrich_tool_call_from_index(update, &index)
        }
        SessionUpdate::ToolCallUpdate {
            update: tool_update,
            session_id,
        } => {
            if !tool_update_needs_enrichment(tool_update) {
                return update;
            }
            let Some(session_id) = session_id.as_deref() else {
                return update;
            };
            let Some(index) =
                load_tool_use_index_for_session(session_id, Some(&tool_update.tool_call_id)).await
            else {
                return update;
            };
            enrich_tool_call_from_index(update, &index)
        }
        _ => normalize_cursor_thought_chunk(update),
    }
}

fn normalize_cursor_thought_chunk(update: SessionUpdate) -> SessionUpdate {
    match update {
        SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            session_id,
        } => match &chunk.content {
            crate::acp::types::ContentBlock::Text { text } if has_thought_prefix(text) => {
                SessionUpdate::AgentThoughtChunk {
                    chunk: crate::acp::session_update::ContentChunk {
                        content: crate::acp::types::ContentBlock::Text {
                            text: strip_thought_prefix(text),
                        },
                        aggregation_hint: chunk.aggregation_hint,
                    },
                    part_id,
                    message_id,
                    session_id,
                }
            }
            _ => SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            },
        },
        other => other,
    }
}

fn has_thought_prefix(text: &str) -> bool {
    strip_thought_prefix(text) != text
}

fn strip_thought_prefix(text: &str) -> String {
    const PREFIXES: [&str; 6] = [
        "[Thinking]",
        "[thinking]",
        "[THINKING]",
        "[Thought]",
        "[thought]",
        "[THOUGHT]",
    ];

    let trimmed = text.trim_start();
    for prefix in PREFIXES {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return rest.trim_start().to_string();
        }
    }

    text.to_string()
}

fn tool_call_needs_enrichment(tool_call: &ToolCallData) -> bool {
    title_is_placeholder(tool_call.title.as_deref())
        || tool_call.locations.is_none()
        || tool_arguments_need_enrichment(&tool_call.arguments)
}

fn tool_update_needs_enrichment(update: &ToolCallUpdateData) -> bool {
    title_is_placeholder(update.title.as_deref())
        || update.locations.is_none()
        || update
            .arguments
            .as_ref()
            .or(update.streaming_arguments.as_ref())
            .is_none_or(tool_arguments_need_enrichment)
}

fn tool_arguments_need_enrichment(arguments: &ToolArguments) -> bool {
    match arguments {
        ToolArguments::Read { file_path } => file_path.is_none(),
        ToolArguments::Delete {
            file_path,
            file_paths,
        } => file_path.is_none() && file_paths.as_ref().is_none_or(|paths| paths.is_empty()),
        ToolArguments::Edit { edits } => edits.first().is_none_or(|edit| {
            edit.file_path.is_none()
                || edit.move_from.is_none()
                || edit.old_string.is_none()
                || edit.new_string.is_none()
                || edit.content.is_none()
        }),
        ToolArguments::Execute { command } => command.is_none(),
        ToolArguments::Search { query, file_path } => query.is_none() || file_path.is_none(),
        ToolArguments::Glob { pattern, path } => pattern.is_none() || path.is_none(),
        ToolArguments::Fetch { url } => url.is_none(),
        ToolArguments::WebSearch { query } => query.is_none(),
        ToolArguments::Think {
            description,
            prompt,
            subagent_type,
            skill,
            skill_args,
            raw,
        } => {
            description.is_none()
                || prompt.is_none()
                || subagent_type.is_none()
                || skill.is_none()
                || skill_args.is_none()
                || raw.is_none()
        }
        ToolArguments::TaskOutput { task_id, .. } => task_id.is_none(),
        ToolArguments::Move { from, to } => from.is_none() || to.is_none(),
        ToolArguments::PlanMode { mode } => mode.is_none(),
        ToolArguments::ToolSearch { query, max_results } => {
            query.is_none() || max_results.is_none()
        }
        ToolArguments::Browser { .. } => false,
        ToolArguments::Other { .. } => tool_arguments_detail_score(arguments) == 0,
    }
}

fn enrich_tool_call_data(
    mut tool_call: ToolCallData,
    index: &HashMap<String, PersistedToolUse>,
) -> ToolCallData {
    let Some(persisted) = index.get(&tool_call.id) else {
        return tool_call;
    };
    let Some(candidate_arguments) = parse_persisted_tool_arguments(persisted) else {
        return tool_call;
    };

    let merged_arguments =
        merge_persisted_arguments(candidate_arguments.clone(), &tool_call.arguments);

    if tool_arguments_detail_score(&merged_arguments)
        > tool_arguments_detail_score(&tool_call.arguments)
    {
        tool_call.arguments = merged_arguments;
    }

    if tool_call.raw_input.is_none() {
        tool_call.raw_input = Some(persisted.input.clone());
    }

    if tool_call.kind.is_none() || tool_call.kind == Some(ToolKind::Other) {
        let candidate_kind = tool_call.arguments.tool_kind();
        if candidate_kind != ToolKind::Other {
            tool_call.kind = Some(candidate_kind);
        }
    }

    if tool_call.locations.is_none() {
        tool_call.locations = synthesize_locations(&tool_call.arguments);
    }

    if title_is_placeholder(tool_call.title.as_deref()) {
        tool_call.title = synthesize_title(&tool_call.arguments).or(tool_call.title);
    }

    tool_call
}

fn enrich_tool_call_update_data(
    mut update: ToolCallUpdateData,
    index: &HashMap<String, PersistedToolUse>,
) -> ToolCallUpdateData {
    let Some(persisted) = index.get(&update.tool_call_id) else {
        return update;
    };
    let Some(candidate_arguments) = parse_persisted_tool_arguments(persisted) else {
        return update;
    };

    let current_arguments = update
        .arguments
        .as_ref()
        .or(update.streaming_arguments.as_ref());
    let current_arguments_score = current_arguments
        .map(tool_arguments_detail_score)
        .unwrap_or(0);
    let merged_arguments = current_arguments
        .map(|arguments| merge_persisted_arguments(candidate_arguments.clone(), arguments))
        .unwrap_or(candidate_arguments);

    if tool_arguments_detail_score(&merged_arguments) > current_arguments_score {
        if update.arguments.is_some() {
            update.arguments = Some(merged_arguments.clone());
        } else if update.streaming_arguments.is_some() {
            update.streaming_arguments = Some(merged_arguments.clone());
        } else {
            update.arguments = Some(merged_arguments.clone());
        }
    }

    let presentation_arguments = update
        .arguments
        .as_ref()
        .or(update.streaming_arguments.as_ref());

    if update.locations.is_none() {
        if let Some(arguments) = presentation_arguments {
            update.locations = synthesize_locations(arguments);
        }
    }

    if title_is_placeholder(update.title.as_deref()) {
        if let Some(arguments) = presentation_arguments {
            update.title = synthesize_title(arguments).or(update.title);
        }
    }

    update
}

fn merge_persisted_arguments(candidate: ToolArguments, current: &ToolArguments) -> ToolArguments {
    match (&candidate, current) {
        (ToolArguments::Edit { .. }, ToolArguments::Edit { .. }) => {
            merge_tool_arguments(candidate, current.clone())
        }
        _ => {
            if tool_arguments_detail_score(&candidate) > tool_arguments_detail_score(current) {
                candidate
            } else {
                current.clone()
            }
        }
    }
}

fn parse_persisted_tool_arguments(persisted: &PersistedToolUse) -> Option<ToolArguments> {
    let parser = get_parser(AgentType::Cursor);
    let detected_kind = parser.detect_tool_kind(&persisted.name);

    parser
        .parse_typed_tool_arguments(
            Some(&persisted.name),
            &persisted.input,
            Some(detected_kind.as_str()),
        )
        .or_else(|| {
            if detected_kind == ToolKind::Other {
                None
            } else {
                Some(ToolArguments::from_raw(
                    detected_kind,
                    persisted.input.clone(),
                ))
            }
        })
}

fn tool_arguments_detail_score(arguments: &ToolArguments) -> usize {
    match arguments {
        ToolArguments::Read { file_path } => usize::from(file_path.is_some()),
        ToolArguments::Edit { edits } => edits.first().map_or(0, |e| {
            usize::from(e.file_path.is_some())
                + usize::from(e.move_from.is_some())
                + usize::from(e.old_string.is_some())
                + usize::from(e.new_string.is_some())
                + usize::from(e.content.is_some())
        }),
        ToolArguments::Execute { command } => usize::from(command.is_some()),
        ToolArguments::Search { query, file_path } => {
            usize::from(query.is_some()) + usize::from(file_path.is_some())
        }
        ToolArguments::Glob { pattern, path } => {
            usize::from(pattern.is_some()) + usize::from(path.is_some())
        }
        ToolArguments::Fetch { url } => usize::from(url.is_some()),
        ToolArguments::WebSearch { query } => usize::from(query.is_some()),
        ToolArguments::Think {
            description,
            prompt,
            subagent_type,
            skill,
            skill_args,
            raw,
        } => {
            usize::from(description.is_some())
                + usize::from(prompt.is_some())
                + usize::from(subagent_type.is_some())
                + usize::from(skill.is_some())
                + usize::from(skill_args.is_some())
                + usize::from(raw.is_some())
        }
        ToolArguments::TaskOutput { task_id, .. } => usize::from(task_id.is_some()),
        ToolArguments::Move { from, to } => usize::from(from.is_some()) + usize::from(to.is_some()),
        ToolArguments::Delete {
            file_path,
            file_paths,
        } => usize::from(
            file_path.is_some() || file_paths.as_ref().is_some_and(|paths| !paths.is_empty()),
        ),
        ToolArguments::PlanMode { mode } => usize::from(mode.is_some()),
        ToolArguments::ToolSearch { query, max_results } => {
            usize::from(query.is_some()) + usize::from(max_results.is_some())
        }
        ToolArguments::Browser { raw } => {
            if raw.is_null() { 0 } else { 1 }
        }
        ToolArguments::Other { raw } => {
            if raw.is_null() {
                return 0;
            }
            if let Some(object) = raw.as_object() {
                return usize::from(!object.is_empty());
            }
            if let Some(array) = raw.as_array() {
                return usize::from(!array.is_empty());
            }
            1
        }
    }
}

async fn load_tool_use_index_for_session(
    session_id: &str,
    tool_call_id: Option<&str>,
) -> Option<HashMap<String, PersistedToolUse>> {
    if let Some(cache) = CURSOR_TOOL_USE_CACHE.get(session_id) {
        if let Some(requested_id) = tool_call_id {
            if cache.tool_uses.contains_key(requested_id) {
                return Some(cache.tool_uses.clone());
            }
        } else {
            return Some(cache.tool_uses.clone());
        }

        if !store_db_changed(&cache).await {
            return Some(cache.tool_uses.clone());
        }
    }

    let refreshed_cache = load_session_tool_use_cache(session_id).await?;
    let index = refreshed_cache.tool_uses.clone();
    CURSOR_TOOL_USE_CACHE.insert(session_id.to_string(), refreshed_cache);
    Some(index)
}

async fn store_db_changed(cache: &SessionToolUseCache) -> bool {
    tokio::fs::metadata(&cache.store_db_path)
        .await
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .is_some_and(|modified_at| modified_at > cache.modified_at)
}

async fn load_session_tool_use_cache(session_id: &str) -> Option<SessionToolUseCache> {
    let store_db_path =
        crate::cursor_history::parser::get_sqlite_store_db_path_for_session(session_id)
            .await
            .ok()??;

    let metadata = tokio::fs::metadata(&store_db_path).await.ok()?;
    let modified_at = metadata.modified().ok()?;
    let session = crate::history::cursor_sqlite_parser::parse_cursor_store_db(
        &store_db_path,
        session_id,
        None,
    )
    .await
    .ok()?;

    Some(SessionToolUseCache {
        store_db_path,
        modified_at,
        tool_uses: build_persisted_tool_use_index(&session),
    })
}

#[cfg(test)]
pub(crate) fn seed_test_tool_use_cache(
    session_id: &str,
    tool_call_id: &str,
    name: &str,
    input: serde_json::Value,
) {
    let mut tool_uses = HashMap::new();
    tool_uses.insert(
        tool_call_id.to_string(),
        PersistedToolUse {
            name: name.to_string(),
            input,
        },
    );

    CURSOR_TOOL_USE_CACHE.insert(
        session_id.to_string(),
        SessionToolUseCache {
            store_db_path: PathBuf::from("cursor-test-store.db"),
            modified_at: SystemTime::UNIX_EPOCH,
            tool_uses,
        },
    );
}

#[cfg(test)]
pub(crate) fn clear_test_tool_use_cache(session_id: &str) {
    CURSOR_TOOL_USE_CACHE.remove(session_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::{ContentChunk, ToolCallStatus, ToolKind};
    use crate::acp::types::ContentBlock as AcpContentBlock;
    use crate::session_jsonl::types::{OrderedMessage, SessionStats};
    use serde_json::json;

    fn assert_is_lazy_lock<T>(_: &std::sync::LazyLock<T>) {}

    #[test]
    fn cursor_tool_use_cache_uses_lazy_lock() {
        assert_is_lazy_lock(&CURSOR_TOOL_USE_CACHE);
    }

    fn make_session_with_tool_use() -> FullSession {
        FullSession {
            session_id: "session-123".to_string(),
            project_path: String::new(),
            title: "Test".to_string(),
            created_at: "2025-01-01T00:00:00Z".to_string(),
            messages: vec![OrderedMessage {
                uuid: "assistant-1".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                timestamp: "2025-01-01T00:00:00Z".to_string(),
                content_blocks: vec![ContentBlock::ToolUse {
                    id: "call-1".to_string(),
                    name: "ReadFile".to_string(),
                    input: json!({
                        "path": "/tmp/example.rs",
                        "offset": 1,
                        "limit": 20
                    }),
                }],
                model: None,
                usage: None,
                request_id: None,
                is_meta: false,
                source_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            }],
            stats: SessionStats::default(),
        }
    }

    #[test]
    fn enriches_cursor_read_tool_call_with_persisted_path() {
        let index = build_persisted_tool_use_index(&make_session_with_tool_use());
        let update = SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "call-1".to_string(),
                name: "Read File".to_string(),
                arguments: ToolArguments::Read { file_path: None },
                raw_input: None,
                status: ToolCallStatus::Pending,
                result: None,
                kind: Some(ToolKind::Read),
                title: Some("Read File".to_string()),
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-123".to_string()),
        };

        let enriched = enrich_tool_call_from_index(update, &index);

        match enriched {
            SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.arguments.tool_kind(), ToolKind::Read);
                assert_eq!(
                    tool_call.raw_input,
                    Some(serde_json::json!({
                        "path": "/tmp/example.rs",
                        "offset": 1,
                        "limit": 20
                    }))
                );
                match tool_call.arguments {
                    ToolArguments::Read { file_path } => {
                        assert_eq!(file_path.as_deref(), Some("/tmp/example.rs"));
                    }
                    other => panic!("Expected read arguments, got {:?}", other),
                }
            }
            other => panic!("Expected ToolCall, got {:?}", other),
        }
    }

    #[test]
    fn enriches_cursor_tool_call_update_with_persisted_path_and_title() {
        let index = build_persisted_tool_use_index(&make_session_with_tool_use());
        let update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "call-1".to_string(),
                status: Some(ToolCallStatus::InProgress),
                result: None,
                content: None,
                raw_output: None,
                title: Some("Read File".to_string()),
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: Some(ToolArguments::Read { file_path: None }),
                failure_reason: None,
            },
            session_id: Some("session-123".to_string()),
        };

        let enriched = enrich_tool_call_from_index(update, &index);

        match enriched {
            SessionUpdate::ToolCallUpdate { update, .. } => {
                match update.arguments {
                    Some(ToolArguments::Read { file_path }) => {
                        assert_eq!(file_path.as_deref(), Some("/tmp/example.rs"));
                    }
                    other => panic!("Expected read arguments, got {:?}", other),
                }
                assert_eq!(update.title.as_deref(), Some("Read /tmp/example.rs"));
                assert_eq!(update.locations.as_ref().map(Vec::len), Some(1));
            }
            other => panic!("Expected ToolCallUpdate, got {:?}", other),
        }
    }

    #[test]
    fn enriches_streaming_cursor_tool_call_update_with_persisted_rename_metadata() {
        let mut session = make_session_with_tool_use();
        session.messages[0].content_blocks = vec![ContentBlock::ToolUse {
            id: "call-rename".to_string(),
            name: "Edit".to_string(),
            input: json!({
                "file_path": "/tmp/new.rs",
                "move_from": "/tmp/old.rs"
            }),
        }];
        let index = build_persisted_tool_use_index(&session);
        let update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "call-rename".to_string(),
                status: Some(ToolCallStatus::InProgress),
                result: None,
                content: None,
                raw_output: None,
                title: Some("Edit File".to_string()),
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: Some(ToolArguments::Edit {
                    edits: vec![crate::acp::session_update::EditEntry {
                        file_path: Some("/tmp/new.rs".to_string()),
                        move_from: None,
                        old_string: None,
                        new_string: None,
                        content: None,
                    }],
                }),
                streaming_plan: None,
                arguments: None,
                failure_reason: None,
            },
            session_id: Some("session-123".to_string()),
        };

        let enriched = enrich_tool_call_from_index(update, &index);

        match enriched {
            SessionUpdate::ToolCallUpdate { update, .. } => {
                match update.streaming_arguments {
                    Some(ToolArguments::Edit { edits }) => {
                        let edit = edits.first().expect("edit entry");
                        assert_eq!(edit.file_path.as_deref(), Some("/tmp/new.rs"));
                        assert_eq!(edit.move_from.as_deref(), Some("/tmp/old.rs"));
                    }
                    other => panic!("Expected streaming edit arguments, got {:?}", other),
                }
                assert_eq!(
                    update.title.as_deref(),
                    Some("Rename /tmp/old.rs -> /tmp/new.rs")
                );
                assert_eq!(update.locations.as_ref().map(Vec::len), Some(1));
            }
            other => panic!("Expected ToolCallUpdate, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn upgrades_thinking_prefixed_cursor_message_chunks_to_thought_chunks() {
        let update = SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: AcpContentBlock::Text {
                    text: "[Thinking] Check the file".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("part-1".to_string()),
            message_id: Some("msg-1".to_string()),
            session_id: Some("session-1".to_string()),
        };

        let enriched = enrich_cursor_session_update(update).await;

        match enriched {
            SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            } => {
                match chunk.content {
                    AcpContentBlock::Text { text } => {
                        assert_eq!(text, "Check the file".to_string());
                    }
                    other => panic!("expected text content, got {other:?}"),
                }
                assert_eq!(part_id.as_deref(), Some("part-1"));
                assert_eq!(message_id.as_deref(), Some("msg-1"));
                assert_eq!(session_id.as_deref(), Some("session-1"));
            }
            other => panic!("expected AgentThoughtChunk, got {other:?}"),
        }
    }
}
