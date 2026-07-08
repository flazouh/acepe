use serde_json::{json, Value};
use std::collections::HashSet;

use crate::acp::projections::{OperationSnapshot, OperationState};
use crate::acp::session_update::{EditEntry, ToolArguments, ToolSourceContext, ToolSourceRange};

const MAX_INLINE_TEXT_BYTES: usize = 512;
const MAX_INLINE_JSON_BYTES: usize = 2_048;
pub(crate) const OPERATION_LIST_ACTIONABLE_COMPACTION_THRESHOLD: usize = 1_000;

pub(crate) fn compact_operations_for_ipc(
    operations: Vec<OperationSnapshot>,
) -> Vec<OperationSnapshot> {
    operations
        .into_iter()
        .map(compact_operation_for_ipc)
        .collect()
}

pub(crate) fn compact_operation_snapshot_for_ipc(
    operation: OperationSnapshot,
) -> OperationSnapshot {
    compact_operation_for_ipc(operation)
}

pub(crate) fn compact_actionable_operations_for_ipc(
    operations: Vec<OperationSnapshot>,
) -> Vec<OperationSnapshot> {
    operations
        .into_iter()
        .filter(operation_can_affect_current_actionability)
        .map(compact_operation_for_ipc)
        .collect()
}

pub(crate) fn compact_viewport_or_actionable_operations_for_ipc(
    operations: Vec<OperationSnapshot>,
    viewport_operation_ids: &HashSet<String>,
    viewport_tool_call_ids: &HashSet<String>,
) -> Vec<OperationSnapshot> {
    operations
        .into_iter()
        .filter(|operation| {
            viewport_operation_ids.contains(&operation.id)
                || viewport_tool_call_ids.contains(&operation.tool_call_id)
                || operation_can_affect_current_actionability(operation)
        })
        .map(compact_operation_for_ipc)
        .collect()
}

fn operation_can_affect_current_actionability(operation: &OperationSnapshot) -> bool {
    matches!(
        operation.operation_state,
        OperationState::Pending
            | OperationState::Running
            | OperationState::Blocked
            | OperationState::Failed
    ) || operation.awaiting_plan_approval
        || operation.plan_approval_request_id.is_some()
        || operation
            .normalized_questions
            .as_ref()
            .is_some_and(|questions| !questions.is_empty())
}

fn compact_operation_for_ipc(operation: OperationSnapshot) -> OperationSnapshot {
    OperationSnapshot {
        id: operation.id,
        session_id: operation.session_id,
        tool_call_id: operation.tool_call_id,
        name: truncate_string(operation.name),
        kind: operation.kind,
        provider_status: operation.provider_status,
        title: operation.title.map(truncate_string),
        arguments: compact_tool_arguments(operation.arguments),
        progressive_arguments: operation.progressive_arguments.map(compact_tool_arguments),
        result: operation.result.map(compact_json_value),
        computer_payload: None,
        command: operation.command.map(truncate_string),
        normalized_todos: operation.normalized_todos,
        parent_tool_call_id: operation.parent_tool_call_id,
        parent_operation_id: operation.parent_operation_id,
        child_tool_call_ids: operation.child_tool_call_ids,
        child_operation_ids: operation.child_operation_ids,
        operation_provenance_key: operation.operation_provenance_key,
        operation_state: operation.operation_state,
        locations: operation.locations,
        skill_meta: operation.skill_meta,
        normalized_questions: operation.normalized_questions,
        question_answer: None,
        awaiting_plan_approval: operation.awaiting_plan_approval,
        plan_approval_request_id: operation.plan_approval_request_id,
        started_at_ms: operation.started_at_ms,
        completed_at_ms: operation.completed_at_ms,
        source_link: operation.source_link,
        degradation_reason: operation.degradation_reason,
    }
}

fn truncate_string(value: String) -> String {
    if value.len() <= MAX_INLINE_TEXT_BYTES {
        return value;
    }

    let end = floor_char_boundary(&value, MAX_INLINE_TEXT_BYTES);
    format!(
        "{} [truncated {} bytes]",
        &value[..end],
        value.len().saturating_sub(end)
    )
}

fn truncate_option_string(value: Option<String>) -> Option<String> {
    value.map(truncate_string)
}

fn floor_char_boundary(value: &str, max_bytes: usize) -> usize {
    let mut end = value.len().min(max_bytes);
    while !value.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    end
}

fn compact_json_value(value: Value) -> Value {
    let byte_len = serde_json::to_vec(&value)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX);
    if byte_len <= MAX_INLINE_JSON_BYTES {
        return value;
    }

    json!({
        "compacted": true,
        "originalByteLength": byte_len
    })
}

fn compact_tool_arguments(arguments: ToolArguments) -> ToolArguments {
    match arguments {
        ToolArguments::Read {
            file_path,
            source_context,
        } => ToolArguments::Read {
            file_path: truncate_option_string(file_path),
            source_context: source_context.map(compact_source_context),
        },
        ToolArguments::ReadLints { raw } => ToolArguments::ReadLints {
            raw: compact_json_value(raw),
        },
        ToolArguments::Edit { edits } => ToolArguments::Edit {
            edits: edits.into_iter().map(compact_edit_entry).collect(),
        },
        ToolArguments::Execute { command } => ToolArguments::Execute {
            command: truncate_option_string(command),
        },
        ToolArguments::ShellInput { shell_id, input } => ToolArguments::ShellInput {
            shell_id: truncate_option_string(shell_id),
            input: truncate_option_string(input),
        },
        ToolArguments::Search { query, file_path } => ToolArguments::Search {
            query: truncate_option_string(query),
            file_path: truncate_option_string(file_path),
        },
        ToolArguments::Glob { pattern, path } => ToolArguments::Glob {
            pattern: truncate_option_string(pattern),
            path: truncate_option_string(path),
        },
        ToolArguments::Fetch { url } => ToolArguments::Fetch {
            url: truncate_option_string(url),
        },
        ToolArguments::WebSearch { query } => ToolArguments::WebSearch {
            query: truncate_option_string(query),
        },
        ToolArguments::Think {
            description,
            prompt,
            subagent_type,
            skill,
            skill_args,
            raw,
        } => ToolArguments::Think {
            description: truncate_option_string(description),
            prompt: truncate_option_string(prompt),
            subagent_type: truncate_option_string(subagent_type),
            skill: truncate_option_string(skill),
            skill_args: truncate_option_string(skill_args),
            raw: raw.map(compact_json_value),
        },
        ToolArguments::TaskOutput { task_id, timeout } => ToolArguments::TaskOutput {
            task_id: truncate_option_string(task_id),
            timeout,
        },
        ToolArguments::Move { from, to } => ToolArguments::Move {
            from: truncate_option_string(from),
            to: truncate_option_string(to),
        },
        ToolArguments::Delete {
            file_path,
            file_paths,
        } => ToolArguments::Delete {
            file_path: truncate_option_string(file_path),
            file_paths: file_paths.map(|paths| paths.into_iter().map(truncate_string).collect()),
        },
        ToolArguments::PlanMode {
            mode,
            plan,
            plan_file_path,
            title,
        } => ToolArguments::PlanMode {
            mode: truncate_option_string(mode),
            plan: truncate_option_string(plan),
            plan_file_path: truncate_option_string(plan_file_path),
            title: truncate_option_string(title),
        },
        ToolArguments::ToolSearch { query, max_results } => ToolArguments::ToolSearch {
            query: truncate_option_string(query),
            max_results,
        },
        ToolArguments::Browser {
            raw,
            action,
            selector,
            script,
        } => ToolArguments::Browser {
            raw: compact_json_value(raw),
            action: truncate_option_string(action),
            selector: truncate_option_string(selector),
            script: truncate_option_string(script),
        },
        ToolArguments::Computer {
            verb,
            target_id,
            epoch,
            text,
            key,
            delta_x,
            delta_y,
            include_bounds,
            include_screenshot,
        } => ToolArguments::Computer {
            verb: truncate_option_string(verb),
            target_id: truncate_option_string(target_id),
            epoch: truncate_option_string(epoch),
            text: truncate_option_string(text),
            key: truncate_option_string(key),
            delta_x,
            delta_y,
            include_bounds,
            include_screenshot,
        },
        ToolArguments::Sql { query, description } => ToolArguments::Sql {
            query: truncate_option_string(query),
            description: truncate_option_string(description),
        },
        ToolArguments::Unclassified {
            provider_name,
            provider_kind_hint,
            title,
            arguments_preview,
            signals_tried,
        } => ToolArguments::Unclassified {
            provider_name: truncate_string(provider_name),
            provider_kind_hint: truncate_option_string(provider_kind_hint),
            title: truncate_option_string(title),
            arguments_preview: truncate_option_string(arguments_preview),
            signals_tried: signals_tried.into_iter().map(truncate_string).collect(),
        },
        ToolArguments::Other { raw, intent } => ToolArguments::Other {
            raw: compact_json_value(raw),
            intent: truncate_option_string(intent),
        },
    }
}

fn compact_source_context(context: ToolSourceContext) -> ToolSourceContext {
    ToolSourceContext {
        path: truncate_option_string(context.path),
        view_range: context.view_range.map(compact_source_range),
        excerpt: truncate_option_string(context.excerpt),
    }
}

fn compact_source_range(range: ToolSourceRange) -> ToolSourceRange {
    ToolSourceRange {
        start_line: range.start_line,
        end_line: range.end_line,
    }
}

fn compact_edit_entry(entry: EditEntry) -> EditEntry {
    EditEntry {
        file_path: truncate_option_string(entry.file_path),
        move_from: truncate_option_string(entry.move_from),
        old_string: truncate_option_string(entry.old_string),
        new_string: truncate_option_string(entry.new_string),
        content: truncate_option_string(entry.content),
    }
}
