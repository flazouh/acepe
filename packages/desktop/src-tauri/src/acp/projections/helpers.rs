use super::*;

pub(crate) fn should_skip_unanswered_question_tool_operation(tool_call: &ToolCallData) -> bool {
    matches!(tool_call.kind, Some(ToolKind::Question)) && tool_call.question_answer.is_none()
}

pub(crate) fn is_exit_plan_permission(permission: &PermissionData) -> bool {
    permission.permission == "ExitPlanMode" || permission.permission == "exit_plan_mode"
}

pub(crate) fn plan_mode_arguments_have_plan(arguments: &ToolArguments) -> bool {
    matches!(
        arguments,
        ToolArguments::PlanMode {
            plan: Some(plan),
            ..
        } if !plan.trim().is_empty()
    )
}

pub(crate) fn read_exit_plan_arguments_from_permission(
    permission: &PermissionData,
) -> Option<ToolArguments> {
    permission
        .metadata
        .get("parsedArguments")
        .and_then(|value| serde_json::from_value::<ToolArguments>(value.clone()).ok())
        .filter(plan_mode_arguments_have_plan)
}

pub(crate) fn create_session_tool_key(session_id: &str, tool_call_id: &str) -> String {
    format!("{session_id}::{tool_call_id}")
}

pub(crate) fn normalize_operation_ingress_tool_call_id(tool_call_id: &str) -> String {
    if tool_call_id.chars().any(char::is_control) {
        return normalize_tool_call_id(tool_call_id);
    }

    tool_call_id.to_string()
}

pub(crate) fn normalize_optional_operation_ingress_tool_call_id(
    tool_call_id: &Option<String>,
) -> Option<String> {
    tool_call_id
        .as_deref()
        .map(normalize_operation_ingress_tool_call_id)
}

pub(crate) fn normalize_tool_call_for_operation_ingress(tool_call: &ToolCallData) -> ToolCallData {
    let mut normalized = tool_call.clone();
    normalized.id = normalize_operation_ingress_tool_call_id(&tool_call.id);
    normalized.parent_tool_use_id =
        normalize_optional_operation_ingress_tool_call_id(&tool_call.parent_tool_use_id);
    normalized.task_children = tool_call.task_children.as_ref().map(|children| {
        children
            .iter()
            .map(normalize_tool_call_for_operation_ingress)
            .collect()
    });
    normalized
}

pub(crate) fn normalize_tool_call_update_for_operation_ingress(
    update: &ToolCallUpdateData,
) -> ToolCallUpdateData {
    let mut normalized = update.clone();
    normalized.tool_call_id = normalize_operation_ingress_tool_call_id(&update.tool_call_id);
    normalized
}

pub(crate) fn convert_turn_error_snapshot(
    error: &crate::acp::session_update::TurnErrorData,
    turn_id: Option<String>,
) -> TurnFailureSnapshot {
    match error {
        crate::acp::session_update::TurnErrorData::Legacy(message) => TurnFailureSnapshot {
            turn_id,
            message: message.clone(),
            code: None,
            kind: crate::acp::session_update::TurnErrorKind::Recoverable,
            source: crate::acp::session_update::TurnErrorSource::Unknown,
        },
        crate::acp::session_update::TurnErrorData::Structured(info) => TurnFailureSnapshot {
            turn_id,
            message: info.message.clone(),
            code: info.code.map(|code| code.to_string()),
            kind: info.kind,
            source: info
                .source
                .unwrap_or(crate::acp::session_update::TurnErrorSource::Unknown),
        },
    }
}

pub(crate) fn create_session_request_key(session_id: &str, request_id: u64) -> String {
    format!("{session_id}::{request_id}")
}

pub(crate) fn rejected_operation_snapshot(
    operation_id: String,
    session_id: &str,
    tool_call: &ToolCallData,
    parent_operation_id: Option<String>,
    parent_tool_call_id: Option<String>,
    degradation_reason: OperationDegradationReason,
    source_link: OperationSourceLink,
) -> OperationSnapshot {
    let source_link = match source_link {
        OperationSourceLink::TranscriptLinked { entry_id } => {
            OperationSourceLink::TranscriptLinked { entry_id }
        }
        OperationSourceLink::Synthetic { .. } | OperationSourceLink::Degraded { .. } => {
            OperationSourceLink::degraded(degradation_reason.clone())
        }
    };

    OperationSnapshot {
        id: operation_id,
        session_id: session_id.to_string(),
        tool_call_id: tool_call.id.clone(),
        name: tool_call.name.clone(),
        kind: tool_call.kind,
        provider_status: tool_call.status.clone(),
        title: tool_call.title.clone(),
        arguments: tool_call.arguments.clone(),
        progressive_arguments: None,
        result: tool_call.result.clone(),
        computer_payload: None,
        command: extract_operation_command(
            Some(&tool_call.arguments),
            None,
            tool_call.title.as_deref(),
        ),
        normalized_todos: tool_call.normalized_todos.clone(),
        parent_tool_call_id,
        parent_operation_id,
        child_tool_call_ids: Vec::new(),
        child_operation_ids: Vec::new(),
        operation_provenance_key: None,
        operation_state: OperationState::Degraded,
        locations: tool_call.locations.clone(),
        skill_meta: tool_call.skill_meta.clone(),
        normalized_questions: tool_call.normalized_questions.clone(),
        question_answer: tool_call.question_answer.clone(),
        awaiting_plan_approval: tool_call.awaiting_plan_approval,
        plan_approval_request_id: tool_call.plan_approval_request_id,
        started_at_ms: None,
        completed_at_ms: None,
        source_link,
        degradation_reason: Some(degradation_reason),
    }
}

pub(crate) fn build_rejected_operation_id(session_id: &str, tool_call_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(tool_call_id.as_bytes());
    let digest = hasher.finalize();
    let provenance_key = format!("rejected-operation-{}", hex::encode(&digest[..16]));
    build_canonical_operation_id(session_id, &provenance_key)
}

pub(crate) fn derive_operation_state(status: &ToolCallStatus) -> OperationState {
    match status {
        ToolCallStatus::Pending => OperationState::Pending,
        ToolCallStatus::InProgress => OperationState::Running,
        ToolCallStatus::Completed => OperationState::Completed,
        ToolCallStatus::Failed => OperationState::Failed,
    }
}

pub(crate) fn is_claude_resumed_missing_tool_result_update(update: &ToolCallUpdateData) -> bool {
    if update.status != Some(ToolCallStatus::Failed) {
        return false;
    }
    if update.failure_reason.as_deref() == Some(CLAUDE_RESUMED_MISSING_TOOL_RESULT_MESSAGE) {
        return true;
    }

    update
        .result
        .as_ref()
        .and_then(|result| result.get("stderr"))
        .and_then(|value| value.as_str())
        == Some(CLAUDE_RESUMED_MISSING_TOOL_RESULT_MESSAGE)
}

pub(crate) fn is_terminal_operation_state(state: &OperationState) -> bool {
    matches!(
        state,
        OperationState::Completed
            | OperationState::Failed
            | OperationState::Cancelled
            | OperationState::Degraded
    )
}

pub(crate) fn build_plan_approval_interaction_id(
    session_id: &str,
    tool_call_id: &str,
    json_rpc_request_id: u64,
) -> String {
    format!("{session_id}\u{0}{tool_call_id}\u{0}plan\u{0}{json_rpc_request_id}")
}

pub(crate) fn normalize_command(value: Option<&str>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.split_whitespace().collect::<Vec<_>>().join(" "))
}

pub(crate) fn extract_command_from_arguments(arguments: Option<&ToolArguments>) -> Option<String> {
    match arguments {
        Some(ToolArguments::Execute { command }) => normalize_command(command.as_deref()),
        _ => None,
    }
}

pub(crate) fn extract_operation_command(
    arguments: Option<&ToolArguments>,
    progressive_arguments: Option<&ToolArguments>,
    title: Option<&str>,
) -> Option<String> {
    if let Some(command) = extract_command_from_arguments(progressive_arguments) {
        return Some(command);
    }

    if let Some(command) = extract_command_from_arguments(arguments) {
        return Some(command);
    }

    let title = title?;
    let stripped = title
        .strip_prefix('`')
        .and_then(|value| value.strip_suffix('`'));
    normalize_command(stripped)
}

pub(crate) fn is_terminal_tool_call_status(status: &ToolCallStatus) -> bool {
    matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed)
}

pub(crate) fn upsert_active_tool_call(active_tool_call_ids: &mut Vec<String>, tool_call_id: &str) {
    if active_tool_call_ids
        .iter()
        .any(|candidate| candidate == tool_call_id)
    {
        return;
    }

    active_tool_call_ids.push(tool_call_id.to_string());
}

pub(crate) fn mark_tool_call_completed(snapshot: &mut SessionSnapshot, tool_call_id: &str) {
    snapshot
        .active_tool_call_ids
        .retain(|candidate| candidate != tool_call_id);
    if snapshot
        .completed_tool_call_ids
        .iter()
        .any(|candidate| candidate == tool_call_id)
    {
        return;
    }

    snapshot
        .completed_tool_call_ids
        .push(tool_call_id.to_string());
}

pub(crate) fn operation_has_terminal_evidence(operation: &OperationSnapshot) -> bool {
    is_terminal_operation_state(&operation.operation_state)
}

pub(crate) fn operation_identity_conflicts(
    existing: &OperationSnapshot,
    incoming: &OperationSnapshot,
) -> bool {
    if existing.session_id != incoming.session_id || existing.tool_call_id != incoming.tool_call_id
    {
        return true;
    }

    if is_path_access_permission_placeholder_operation(existing) {
        return false;
    }

    matches!(
        (existing.kind, incoming.kind),
        (Some(existing_kind), Some(incoming_kind)) if existing_kind != incoming_kind
    )
}

pub(crate) fn is_path_access_permission_placeholder_operation(
    operation: &OperationSnapshot,
) -> bool {
    if !matches!(
        operation.provider_status,
        ToolCallStatus::Pending | ToolCallStatus::InProgress
    ) {
        return false;
    }

    operation.title.as_deref().is_some_and(|title| {
        title
            .trim()
            .eq_ignore_ascii_case("Access paths outside trusted directories")
    })
}

pub(crate) fn merge_unique_strings(existing: &[String], incoming: Vec<String>) -> Vec<String> {
    let mut merged = existing.to_vec();
    for value in incoming {
        if !merged.iter().any(|candidate| candidate == &value) {
            merged.push(value);
        }
    }
    merged
}

pub(crate) fn merge_operation_source_link(
    existing: &OperationSourceLink,
    incoming: OperationSourceLink,
) -> OperationSourceLink {
    match (existing, incoming) {
        (
            OperationSourceLink::TranscriptLinked {
                entry_id: existing_id,
            },
            OperationSourceLink::TranscriptLinked {
                entry_id: incoming_id,
            },
        ) if live_tool_event_seq(&incoming_id) > live_tool_event_seq(existing_id) => {
            OperationSourceLink::TranscriptLinked {
                entry_id: incoming_id,
            }
        }
        (OperationSourceLink::TranscriptLinked { entry_id }, _) => {
            OperationSourceLink::TranscriptLinked {
                entry_id: entry_id.clone(),
            }
        }
        (_, OperationSourceLink::TranscriptLinked { entry_id }) => {
            OperationSourceLink::TranscriptLinked { entry_id }
        }
        (_, OperationSourceLink::Degraded { reason }) => OperationSourceLink::Degraded { reason },
        (OperationSourceLink::Degraded { reason }, _) => OperationSourceLink::Degraded {
            reason: reason.clone(),
        },
        (_, OperationSourceLink::Synthetic { reason }) => OperationSourceLink::Synthetic { reason },
    }
}

pub(crate) fn live_tool_event_seq(entry_id: &str) -> Option<i64> {
    entry_id
        .strip_prefix("tool-event-")
        .and_then(|suffix| suffix.parse::<i64>().ok())
}

pub(crate) fn merge_update_arguments_with_existing(
    existing: &ToolArguments,
    incoming: Option<&ToolArguments>,
) -> ToolArguments {
    match (existing, incoming) {
        (
            ToolArguments::Read {
                file_path: existing_file_path,
                source_context: existing_source_context,
            },
            Some(ToolArguments::Read {
                file_path: incoming_file_path,
                source_context: incoming_source_context,
            }),
        ) => ToolArguments::Read {
            file_path: incoming_file_path
                .clone()
                .or_else(|| existing_file_path.clone()),
            source_context: merge_tool_source_context(
                existing_source_context.as_ref(),
                incoming_source_context.as_ref(),
            ),
        },
        (_, Some(incoming)) => incoming.clone(),
        (_, None) => existing.clone(),
    }
}

pub(crate) fn merge_tool_source_context(
    existing: Option<&ToolSourceContext>,
    incoming: Option<&ToolSourceContext>,
) -> Option<ToolSourceContext> {
    match (existing, incoming) {
        (Some(existing), Some(incoming)) => Some(ToolSourceContext {
            path: incoming.path.clone().or_else(|| existing.path.clone()),
            view_range: incoming
                .view_range
                .clone()
                .or_else(|| existing.view_range.clone()),
            excerpt: incoming
                .excerpt
                .clone()
                .or_else(|| existing.excerpt.clone()),
        }),
        (Some(existing), None) => Some(existing.clone()),
        (None, Some(incoming)) => Some(incoming.clone()),
        (None, None) => None,
    }
}

pub(crate) fn enrich_read_arguments_with_update_output(
    arguments: ToolArguments,
    update: &ToolCallUpdateData,
) -> ToolArguments {
    let ToolArguments::Read {
        file_path,
        source_context,
    } = arguments
    else {
        return arguments;
    };

    if source_context
        .as_ref()
        .and_then(|context| context.excerpt.as_ref())
        .is_some()
    {
        return ToolArguments::Read {
            file_path,
            source_context,
        };
    }

    let Some(excerpt) = extract_tool_update_text(update) else {
        return ToolArguments::Read {
            file_path,
            source_context,
        };
    };

    let mut source_context = source_context.unwrap_or(ToolSourceContext {
        path: None,
        view_range: None,
        excerpt: None,
    });
    source_context.path = source_context.path.or_else(|| file_path.clone());
    source_context.excerpt = Some(excerpt);

    ToolArguments::Read {
        file_path,
        source_context: Some(source_context),
    }
}

pub(crate) fn enrich_read_arguments_from_filesystem(arguments: ToolArguments) -> ToolArguments {
    let ToolArguments::Read {
        file_path,
        source_context,
    } = arguments
    else {
        return arguments;
    };

    if source_context
        .as_ref()
        .and_then(|context| context.excerpt.as_ref())
        .is_some()
    {
        return ToolArguments::Read {
            file_path,
            source_context,
        };
    }

    let Some(path) = source_context
        .as_ref()
        .and_then(|context| context.path.clone())
        .or_else(|| file_path.clone())
    else {
        return ToolArguments::Read {
            file_path,
            source_context,
        };
    };

    let Some(excerpt) = read_source_excerpt_from_path(&path) else {
        return ToolArguments::Read {
            file_path,
            source_context,
        };
    };

    let mut source_context = source_context.unwrap_or(ToolSourceContext {
        path: None,
        view_range: None,
        excerpt: None,
    });
    source_context.path = source_context.path.or(Some(path));
    source_context.excerpt = Some(excerpt);

    ToolArguments::Read {
        file_path,
        source_context: Some(source_context),
    }
}

pub(crate) fn read_source_excerpt_from_path(path: &str) -> Option<String> {
    let path = std::path::Path::new(path);
    if !path.is_absolute() {
        return None;
    }
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > READ_SOURCE_EXCERPT_MAX_BYTES {
        return None;
    }
    std::fs::read_to_string(path)
        .ok()
        .filter(|content| !content.is_empty())
}

pub(crate) fn extract_tool_update_text(update: &ToolCallUpdateData) -> Option<String> {
    extract_text_from_content_blocks(update.content.as_deref())
        .or_else(|| {
            update
                .result
                .as_ref()
                .and_then(extract_text_from_json_value)
        })
        .or_else(|| {
            update
                .raw_output
                .as_ref()
                .and_then(extract_text_from_json_value)
        })
}

pub(crate) fn extract_text_from_content_blocks(blocks: Option<&[ContentBlock]>) -> Option<String> {
    let text = blocks?
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            ContentBlock::Resource { resource } => resource.text.as_deref(),
            ContentBlock::Image { .. }
            | ContentBlock::Audio { .. }
            | ContentBlock::ResourceLink { .. } => None,
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    (!text.is_empty()).then_some(text)
}

pub(crate) fn extract_text_from_json_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Object(object) => ["content", "detailedContent", "text", "output"]
            .iter()
            .find_map(|key| object.get(*key).and_then(extract_text_from_json_value)),
        Value::Array(values) => {
            let text = values
                .iter()
                .filter_map(extract_text_from_json_value)
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            (!text.is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn is_active_operation_state(state: &OperationState) -> bool {
    matches!(
        state,
        OperationState::Pending | OperationState::Running | OperationState::Blocked
    )
}

pub(crate) fn apply_operation_lifecycle_timing(
    previous: Option<&OperationSnapshot>,
    operation: &mut OperationSnapshot,
    now_ms: u64,
) {
    let was_active = previous
        .map(|snapshot| is_active_operation_state(&snapshot.operation_state))
        .unwrap_or(false);
    let is_active = is_active_operation_state(&operation.operation_state);

    if is_active && operation.started_at_ms.is_none() {
        operation.started_at_ms = Some(now_ms);
    }

    if was_active && !is_active && operation.completed_at_ms.is_none() {
        operation.completed_at_ms = Some(now_ms);
    }
}

pub(crate) fn finalize_operation_snapshot(
    existing: Option<&OperationSnapshot>,
    operation: OperationSnapshot,
) -> OperationSnapshot {
    if let Some(existing) = existing {
        merge_operation_snapshot_evidence(existing, operation)
    } else {
        let mut created = operation;
        apply_operation_lifecycle_timing(
            None,
            &mut created,
            crate::acp::session_state_engine::timing::wall_clock_ms(),
        );
        created
    }
}

pub(crate) fn merge_operation_snapshot_evidence(
    existing: &OperationSnapshot,
    mut incoming: OperationSnapshot,
) -> OperationSnapshot {
    let conflicts = operation_identity_conflicts(existing, &incoming);
    let existing_terminal = operation_has_terminal_evidence(existing);
    let incoming_terminal = operation_has_terminal_evidence(&incoming);

    if conflicts {
        incoming.session_id = existing.session_id.clone();
        incoming.tool_call_id = existing.tool_call_id.clone();
        incoming.name = existing.name.clone();
        incoming.kind = existing.kind;
        incoming.arguments = existing.arguments.clone();
        incoming.operation_state = OperationState::Degraded;
        incoming.degradation_reason = Some(OperationDegradationReason {
            code: OperationDegradationCode::ImpossibleTransition,
            detail: Some(
                "Conflicting operation evidence was received for the same canonical operation."
                    .to_string(),
            ),
        });
    } else if existing_terminal {
        incoming.operation_state = existing.operation_state.clone();
        if !incoming_terminal {
            incoming.provider_status = existing.provider_status.clone();
        }
    }

    incoming.id = existing.id.clone();
    incoming.title = incoming.title.or_else(|| existing.title.clone());
    if operation_has_terminal_evidence(&incoming) {
        incoming.progressive_arguments = None;
    } else {
        incoming.progressive_arguments = incoming
            .progressive_arguments
            .or_else(|| existing.progressive_arguments.clone());
    }
    incoming.result = incoming.result.or_else(|| existing.result.clone());
    incoming.computer_payload = incoming
        .computer_payload
        .or_else(|| existing.computer_payload.clone());
    incoming.command = incoming.command.or_else(|| existing.command.clone());
    incoming.normalized_todos = incoming
        .normalized_todos
        .or_else(|| existing.normalized_todos.clone());
    incoming.parent_tool_call_id = incoming
        .parent_tool_call_id
        .or_else(|| existing.parent_tool_call_id.clone());
    incoming.parent_operation_id = incoming
        .parent_operation_id
        .or_else(|| existing.parent_operation_id.clone());
    incoming.child_tool_call_ids =
        merge_unique_strings(&existing.child_tool_call_ids, incoming.child_tool_call_ids);
    incoming.child_operation_ids =
        merge_unique_strings(&existing.child_operation_ids, incoming.child_operation_ids);
    incoming.operation_provenance_key = incoming
        .operation_provenance_key
        .or_else(|| existing.operation_provenance_key.clone());
    incoming.locations = incoming.locations.or_else(|| existing.locations.clone());
    incoming.skill_meta = incoming.skill_meta.or_else(|| existing.skill_meta.clone());
    incoming.normalized_questions = incoming
        .normalized_questions
        .or_else(|| existing.normalized_questions.clone());
    incoming.question_answer = incoming
        .question_answer
        .or_else(|| existing.question_answer.clone());
    incoming.awaiting_plan_approval =
        incoming.awaiting_plan_approval || existing.awaiting_plan_approval;
    incoming.plan_approval_request_id = incoming
        .plan_approval_request_id
        .or(existing.plan_approval_request_id);
    incoming.started_at_ms = incoming.started_at_ms.or(existing.started_at_ms);
    incoming.completed_at_ms = incoming.completed_at_ms.or(existing.completed_at_ms);
    apply_operation_lifecycle_timing(
        Some(existing),
        &mut incoming,
        crate::acp::session_state_engine::timing::wall_clock_ms(),
    );
    incoming.source_link = if conflicts {
        OperationSourceLink::degraded(OperationDegradationReason {
            code: OperationDegradationCode::ImpossibleTransition,
            detail: Some(
                "Conflicting operation evidence prevents a trustworthy transcript source link."
                    .to_string(),
            ),
        })
    } else {
        merge_operation_source_link(&existing.source_link, incoming.source_link)
    };
    if !conflicts {
        incoming.degradation_reason = incoming
            .degradation_reason
            .or_else(|| existing.degradation_reason.clone());
    }

    incoming
}
