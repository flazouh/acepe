use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::session_update::{build_tool_call_from_raw, RawToolCallInput, ToolCallStatus};
use crate::acp::streaming_log::log_streaming_event;
use serde_json::{json, Value};

use super::helpers::{
    build_permission_request_log_payload, parse_params, parse_permission_tool_arguments,
    resolve_reject_option_id, should_auto_deny_tcc_permission,
};
use super::types::SessionRequestPermissionParamsRaw;
use super::{InboundRoutingDecision, SyntheticToolCallContext};

pub(super) async fn handle_session_request_permission(
    params: &Value,
    agent_type: AgentType,
) -> InboundRoutingDecision {
    let parsed: SessionRequestPermissionParamsRaw = match parse_params(params) {
        Ok(parsed) => parsed,
        Err(_) => {
            return InboundRoutingDecision::ForwardToUi {
                parsed_arguments: None,
                synthetic_tool_call: None,
            }
        }
    };

    let SessionRequestPermissionParamsRaw {
        session_id,
        tool_call,
        options,
    } = parsed;

    let tool_call = match tool_call {
        Some(tool_call) => tool_call,
        None => {
            return InboundRoutingDecision::ForwardToUi {
                parsed_arguments: None,
                synthetic_tool_call: None,
            }
        }
    };

    let parser = get_parser(agent_type);
    let inferred_tool_name = parser.infer_tool_display_name(
        tool_call.name.as_deref(),
        &tool_call.raw_input,
        tool_call.kind.as_deref(),
    );
    let candidate_names = [
        tool_call.name.as_deref(),
        tool_call.title.as_deref(),
        tool_call.kind.as_deref(),
        Some(inferred_tool_name.as_str()),
    ];
    let blocked = candidate_names.into_iter().flatten().any(|name| {
        should_auto_deny_tcc_permission(
            name,
            std::env::consts::OS,
            std::env::var("ACEPE_ALLOW_TCC_AUTOMATION_TOOLS")
                .ok()
                .as_deref(),
        )
    });

    let parsed_arguments = parse_permission_tool_arguments(
        tool_call.name.as_deref(),
        tool_call.raw_input.clone(),
        tool_call.kind.as_deref(),
        agent_type,
    );

    let auto_reject_option_id = blocked.then(|| resolve_reject_option_id(&options));

    if let Some(session_id) = session_id.as_deref() {
        let payload = build_permission_request_log_payload(
            "session/request_permission",
            params,
            tool_call.name.as_deref(),
            tool_call.title.as_deref(),
            parsed_arguments.as_ref(),
            blocked,
            auto_reject_option_id.as_deref(),
        );
        log_streaming_event(session_id, &payload);
    }

    if let Some(reject_option_id) = auto_reject_option_id {
        return InboundRoutingDecision::Handle(json!({
            "outcome": {
                "outcome": "cancelled",
                "optionId": reject_option_id
            }
        }));
    }

    // Build ToolCallData via the same pipeline as normal tool_call events.
    let synthetic_tool_call = match (&tool_call.tool_call_id, &session_id) {
        (Some(tool_call_id), Some(_)) => {
            let raw = RawToolCallInput {
                id: tool_call_id.clone(),
                name: inferred_tool_name,
                arguments: tool_call.raw_input.clone(),
                status: ToolCallStatus::InProgress,
                kind: tool_call
                    .kind
                    .as_deref()
                    .map(|s| parser.detect_tool_kind(s)),
                title: tool_call.title.clone(),
                parent_tool_use_id: None,
                task_children: None,
            };
            let tool_call_data = build_tool_call_from_raw(parser, raw);
            Some(Box::new(SyntheticToolCallContext { tool_call_data }))
        }
        _ => None,
    };

    InboundRoutingDecision::ForwardToUi {
        parsed_arguments,
        synthetic_tool_call,
    }
}
