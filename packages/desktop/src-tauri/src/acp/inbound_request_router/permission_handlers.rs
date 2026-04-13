use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_policy::SessionPolicyRegistry;
use crate::acp::session_update::{
    build_tool_call_from_raw, InteractionReplyHandler, PermissionData, QuestionData, QuestionItem,
    QuestionOption, RawToolCallInput, SessionUpdate, ToolCallStatus, ToolKind, ToolReference,
};
use crate::acp::streaming_log::log_streaming_event;
use crate::acp::tool_classification::{resolve_raw_tool_identity, ToolClassificationHints};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::helpers::{
    build_permission_request_log_payload, parse_params, parse_permission_tool_arguments,
};
use super::types::{
    InboundQuestionItemRaw, PermissionOptionRaw, PermissionRequestMetaRaw, PermissionToolCallRaw,
    RawInputWithQuestionsRaw, SessionRequestPermissionParamsRaw,
};
use super::{InboundRoutingDecision, SyntheticToolCallContext};

pub(super) async fn handle_session_request_permission(
    app_handle: Option<&AppHandle>,
    params: &Value,
    request_id: u64,
    agent_type: AgentType,
) -> InboundRoutingDecision {
    let session_policy = app_handle.and_then(|app| {
        app.try_state::<std::sync::Arc<SessionPolicyRegistry>>()
            .map(|state| state.inner().clone())
    });
    let projection_registry = app_handle.and_then(|app| {
        app.try_state::<std::sync::Arc<ProjectionRegistry>>()
            .map(|state| state.inner().clone())
    });

    handle_session_request_permission_with_state(
        params,
        request_id,
        agent_type,
        session_policy.as_deref(),
        projection_registry.as_deref(),
    )
    .await
}

async fn handle_session_request_permission_with_state(
    params: &Value,
    request_id: u64,
    agent_type: AgentType,
    session_policy: Option<&SessionPolicyRegistry>,
    projection_registry: Option<&ProjectionRegistry>,
) -> InboundRoutingDecision {
    let parsed: SessionRequestPermissionParamsRaw = match parse_params(params) {
        Ok(parsed) => parsed,
        Err(_) => {
            return InboundRoutingDecision::ForwardToUi {
                parsed_arguments: None,
                synthetic_tool_call: None,
                canonical_interaction: None,
                forward_legacy_event: true,
            };
        }
    };

    let SessionRequestPermissionParamsRaw {
        session_id,
        options,
        tool_call,
        meta,
    } = parsed;

    let tool_call = match tool_call {
        Some(tool_call) => tool_call,
        None => {
            return InboundRoutingDecision::ForwardToUi {
                parsed_arguments: None,
                synthetic_tool_call: None,
                canonical_interaction: None,
                forward_legacy_event: true,
            };
        }
    };

    let parser = get_parser(agent_type);
    let tool_call_id = normalized_tool_call_id(&tool_call, request_id);
    let identity = resolve_raw_tool_identity(
        parser,
        &tool_call_id,
        Some(&tool_call.raw_input),
        ToolClassificationHints {
            name: tool_call.name.as_deref(),
            title: tool_call.title.as_deref(),
            kind: tool_call
                .kind
                .as_deref()
                .map(|kind| parser.detect_tool_kind(kind)),
            kind_hint: tool_call.kind.as_deref(),
            locations: None,
        },
    );
    let parsed_arguments = parse_permission_tool_arguments(
        &tool_call_id,
        tool_call.name.as_deref(),
        tool_call.title.as_deref(),
        tool_call.raw_input.clone(),
        tool_call.kind.as_deref(),
        agent_type,
    );

    if let Some(session_id) = session_id.as_deref() {
        let payload = build_permission_request_log_payload(
            "session/request_permission",
            params,
            tool_call.name.as_deref(),
            tool_call.title.as_deref(),
            parsed_arguments.as_ref(),
            false,
            None,
        );
        log_streaming_event(session_id, &payload);
    }

    let auto_accept_reason = session_id.as_deref().and_then(|session_id| {
        auto_accept_reason(
            session_policy,
            projection_registry,
            session_id,
            &tool_call_id,
            identity.kind,
        )
    });

    // Build ToolCallData via the same pipeline as normal tool_call events.
    let synthetic_tool_call = match session_id.as_deref() {
        Some(_) => {
            let raw = RawToolCallInput {
                id: tool_call_id.clone(),
                name: identity.name.clone(),
                arguments: tool_call.raw_input.clone(),
                status: ToolCallStatus::InProgress,
                kind: Some(identity.kind),
                title: tool_call.title.clone(),
                suppress_title_read_path_hint: false,
                parent_tool_use_id: None,
                task_children: None,
            };
            let tool_call_data = build_tool_call_from_raw(parser, raw);
            Some(Box::new(SyntheticToolCallContext { tool_call_data }))
        }
        None => None,
    };

    let canonical_interaction = session_id.as_deref().and_then(|session_id| {
        build_canonical_interaction(CanonicalInteractionArgs {
            session_id,
            request_id,
            tool_call: &tool_call,
            tool_call_id: &tool_call_id,
            parsed_arguments: parsed_arguments.as_ref(),
            options: &options,
            meta: meta.as_ref(),
            auto_accepted: auto_accept_reason.is_some(),
        })
    });

    if auto_accept_reason.is_some() {
        return InboundRoutingDecision::AutoRespond {
            result: allow_permission_response(&options),
            session_id,
            synthetic_tool_call,
            canonical_interaction,
        };
    }

    InboundRoutingDecision::ForwardToUi {
        parsed_arguments,
        synthetic_tool_call,
        canonical_interaction,
        forward_legacy_event: false,
    }
}

fn normalized_tool_call_id(tool_call: &PermissionToolCallRaw, request_id: u64) -> String {
    tool_call
        .tool_call_id
        .clone()
        .unwrap_or_else(|| format!("permission-request-{request_id}"))
}

fn normalized_tool_label(tool_call: &PermissionToolCallRaw) -> String {
    tool_call
        .title
        .clone()
        .or_else(|| tool_call.name.clone())
        .unwrap_or_else(|| "Execute tool".to_string())
}

fn build_permission_id(session_id: &str, tool_call_id: &str, request_id: u64) -> String {
    format!("{session_id}\u{0}{tool_call_id}\u{0}{request_id}")
}

struct CanonicalInteractionArgs<'a> {
    session_id: &'a str,
    request_id: u64,
    tool_call: &'a PermissionToolCallRaw,
    tool_call_id: &'a str,
    parsed_arguments: Option<&'a Value>,
    options: &'a [PermissionOptionRaw],
    meta: Option<&'a PermissionRequestMetaRaw>,
    auto_accepted: bool,
}

fn build_canonical_interaction(args: CanonicalInteractionArgs<'_>) -> Option<SessionUpdate> {
    if let Some(question) = build_question_update(
        args.session_id,
        args.request_id,
        args.tool_call,
        args.tool_call_id,
        args.meta,
    ) {
        return Some(question);
    }

    Some(SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: build_permission_id(args.session_id, args.tool_call_id, args.request_id),
            session_id: args.session_id.to_string(),
            json_rpc_request_id: Some(args.request_id),
            reply_handler: Some(InteractionReplyHandler::json_rpc(args.request_id)),
            permission: normalized_tool_label(args.tool_call),
            patterns: Vec::new(),
            metadata: json!({
                "rawInput": args.tool_call.raw_input.clone(),
                "parsedArguments": args.parsed_arguments.cloned(),
                "options": args.options,
            }),
            always: args
                .options
                .iter()
                .filter(|option| option.kind == "allow_always")
                .map(|option| option.option_id.clone())
                .collect(),
            auto_accepted: args.auto_accepted,
            tool: Some(ToolReference {
                message_id: String::new(),
                call_id: args.tool_call_id.to_string(),
            }),
        },
        session_id: Some(args.session_id.to_string()),
    })
}

fn build_question_update(
    session_id: &str,
    request_id: u64,
    tool_call: &PermissionToolCallRaw,
    tool_call_id: &str,
    meta: Option<&PermissionRequestMetaRaw>,
) -> Option<SessionUpdate> {
    let questions = extract_questions(tool_call, meta)?;
    Some(SessionUpdate::QuestionRequest {
        question: QuestionData {
            id: tool_call_id.to_string(),
            session_id: session_id.to_string(),
            json_rpc_request_id: Some(request_id),
            reply_handler: Some(InteractionReplyHandler::json_rpc(request_id)),
            questions,
            tool: Some(ToolReference {
                message_id: String::new(),
                call_id: tool_call_id.to_string(),
            }),
        },
        session_id: Some(session_id.to_string()),
    })
}

fn extract_questions(
    tool_call: &PermissionToolCallRaw,
    meta: Option<&PermissionRequestMetaRaw>,
) -> Option<Vec<QuestionItem>> {
    if let Some(ask_user_question) = meta.and_then(|meta| meta.ask_user_question.as_ref()) {
        return Some(normalize_question_items(&ask_user_question.questions));
    }

    let is_ask_user_question = tool_call
        .name
        .as_deref()
        .or(tool_call.title.as_deref())
        .is_some_and(|value| value.eq_ignore_ascii_case("AskUserQuestion"));
    if !is_ask_user_question {
        return None;
    }

    let raw_input =
        serde_json::from_value::<RawInputWithQuestionsRaw>(tool_call.raw_input.clone()).ok()?;
    Some(normalize_question_items(&raw_input.questions))
}

fn normalize_question_items(questions: &[InboundQuestionItemRaw]) -> Vec<QuestionItem> {
    questions
        .iter()
        .map(|question| QuestionItem {
            question: question.question.clone(),
            header: question.header.clone(),
            options: question
                .options
                .iter()
                .map(|option| QuestionOption {
                    label: option.label.clone(),
                    description: option.description.clone(),
                })
                .collect(),
            multi_select: question.multi_select,
        })
        .collect()
}

fn auto_accept_reason(
    session_policy: Option<&SessionPolicyRegistry>,
    projection_registry: Option<&ProjectionRegistry>,
    session_id: &str,
    tool_call_id: &str,
    tool_kind: ToolKind,
) -> Option<&'static str> {
    let operation = projection_registry
        .and_then(|registry| registry.operation_for_tool_call(session_id, tool_call_id));
    let effective_tool_kind = operation
        .as_ref()
        .and_then(|operation| operation.kind)
        .unwrap_or(tool_kind);

    if matches!(
        effective_tool_kind,
        ToolKind::Question | ToolKind::ExitPlanMode
    ) {
        return None;
    }

    if session_policy.is_some_and(|policy| policy.is_autonomous(session_id)) {
        return Some("autonomous");
    }

    operation
        .as_ref()
        .and_then(|operation| operation.parent_tool_call_id.as_ref())
        .map(|_| "child_tool_call")
}

fn allow_permission_response(options: &[PermissionOptionRaw]) -> Value {
    json!({
        "outcome": {
            "outcome": "selected",
            "optionId": allow_option_id(options),
        }
    })
}

fn allow_option_id(options: &[PermissionOptionRaw]) -> String {
    options
        .iter()
        .find(|option| option.kind == "allow_once")
        .map(|option| option.option_id.clone())
        .unwrap_or_else(|| "allow".to_string())
}

#[cfg(test)]
mod tests {
    use super::handle_session_request_permission_with_state;
    use crate::acp::inbound_request_router::InboundRoutingDecision;
    use crate::acp::parsers::AgentType;
    use crate::acp::projections::ProjectionRegistry;
    use crate::acp::session_policy::SessionPolicyRegistry;
    use crate::acp::session_update::{
        SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
    };
    use serde_json::json;

    fn child_tool_call(tool_call_id: &str, parent_tool_call_id: &str) -> ToolCallData {
        ToolCallData {
            id: tool_call_id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/tmp/example.txt".to_string()),
            },
            raw_input: Some(json!({ "file_path": "/tmp/example.txt" })),
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Read),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: Some(parent_tool_call_id.to_string()),
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        }
    }

    #[tokio::test]
    async fn auto_responds_when_session_policy_is_autonomous() {
        let session_policy = SessionPolicyRegistry::new();
        session_policy.set_autonomous("session-1", true);

        let decision = handle_session_request_permission_with_state(
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-1",
                    "name": "Bash",
                    "rawInput": { "command": "git status" }
                },
                "options": [
                    { "kind": "allow_once", "name": "Allow once", "optionId": "allow_once" }
                ]
            }),
            7,
            AgentType::Copilot,
            Some(&session_policy),
            Some(&ProjectionRegistry::new()),
        )
        .await;

        match decision {
            InboundRoutingDecision::AutoRespond {
                result,
                session_id: Some(session_id),
                synthetic_tool_call: Some(synthetic_tool_call),
                canonical_interaction: Some(SessionUpdate::PermissionRequest { permission, .. }),
                ..
            } => {
                assert_eq!(session_id, "session-1");
                assert_eq!(result["outcome"]["optionId"], "allow_once");
                assert_eq!(synthetic_tool_call.tool_call_data.id, "tc-1");
                assert!(permission.auto_accepted);
            }
            other => panic!("expected auto-respond decision, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn auto_responds_for_child_tool_permissions_when_policy_is_off() {
        let projection_registry = ProjectionRegistry::new();
        projection_registry.apply_session_update(
            "session-1",
            &SessionUpdate::ToolCall {
                tool_call: child_tool_call("tc-child", "tc-parent"),
                session_id: Some("session-1".to_string()),
            },
        );

        let decision = handle_session_request_permission_with_state(
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-child",
                    "name": "Read",
                    "rawInput": { "file_path": "/tmp/example.txt" }
                },
                "options": []
            }),
            7,
            AgentType::OpenCode,
            Some(&SessionPolicyRegistry::new()),
            Some(&projection_registry),
        )
        .await;

        match decision {
            InboundRoutingDecision::AutoRespond {
                session_id: Some(session_id),
                canonical_interaction: Some(SessionUpdate::PermissionRequest { permission, .. }),
                ..
            } => {
                assert_eq!(session_id, "session-1");
                assert!(permission.auto_accepted);
                assert_eq!(
                    permission.tool.as_ref().map(|tool| tool.call_id.as_str()),
                    Some("tc-child")
                );
            }
            other => panic!("expected child auto-respond decision, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn exit_plan_permissions_still_forward_to_ui_when_autonomous() {
        let session_policy = SessionPolicyRegistry::new();
        session_policy.set_autonomous("session-1", true);

        let decision = handle_session_request_permission_with_state(
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-exit-plan",
                    "name": "ExitPlanMode",
                    "rawInput": {}
                },
                "options": []
            }),
            7,
            AgentType::Copilot,
            Some(&session_policy),
            Some(&ProjectionRegistry::new()),
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                canonical_interaction: Some(SessionUpdate::PermissionRequest { permission, .. }),
                forward_legacy_event: false,
                ..
            } => {
                assert!(!permission.auto_accepted);
            }
            other => panic!("expected forward-to-ui decision, got {:?}", other),
        }
    }
}
