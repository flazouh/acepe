use super::*;
use crate::acp::model_display::{ModelDisplayFamily, UsageMetricsPresentation};
use crate::acp::parsers::provider_capabilities::{
    find_provider_capabilities_by_id, EditNormalization, InvocationEnrichment,
    ProviderCapabilities, ToolVocabulary, TransportFamily, UsageTelemetryFamily,
};
use crate::acp::parsers::types::ParsedUsageTelemetry;
use crate::acp::provider::{
    BackendIdentityPolicy, FrontendProviderProjection, FrontendVariantGroup, HistoryReplayFamily,
    HistoryReplayPolicy, PlanAdapterPolicy, PreconnectionCapabilityMode, PreconnectionSlashMode,
};
use crate::acp::providers::CustomAgentConfig;
use crate::acp::registry::AgentRegistry;
use crate::acp::session_update::{PlanSource, ToolCallStatus, ToolKind};
use serde_json::json;
use std::collections::HashMap;

struct FutureSharedChatParser;

static FUTURE_PROVIDER_CAPABILITIES: [ProviderCapabilities; 1] = [ProviderCapabilities {
    provider_id: "future-shared-chat",
    agent: AgentType::ClaudeCode,
    parser: &FutureSharedChatParser,
    backend_identity_policy: BackendIdentityPolicy {
        requires_persisted_provider_session_id: false,
        prefers_incoming_provider_session_id_alias: false,
    },
    plan_adapter_policy: PlanAdapterPolicy {
        parses_wrapper_plan_from_text_stream: false,
        finalizes_wrapper_plan_on_turn_end: false,
        clears_message_tracker_on_prompt_response: false,
    },
    history_replay_policy: HistoryReplayPolicy {
        family: HistoryReplayFamily::SharedCanonical,
    },
    frontend_projection: FrontendProviderProjection {
        provider_brand: "future-shared-chat",
        display_name: "Future Shared Chat",
        display_order: 999,
        supports_model_defaults: false,
        variant_group: FrontendVariantGroup::Plain,
        default_alias: None,
        reasoning_effort_support: false,
        preconnection_slash_mode: PreconnectionSlashMode::Unsupported,
        preconnection_capability_mode: PreconnectionCapabilityMode::Unsupported,
    },
    transport_family: TransportFamily::SharedChat,
    tool_vocabulary: ToolVocabulary::ClaudeCode,
    invocation_enrichment: InvocationEnrichment {
        parsed_cmd_recovery: false,
        non_destructive_path_hints: false,
        nested_argument_merge: false,
        location_path_hint: false,
    },
    edit_normalization: EditNormalization::ClaudeCode,
    usage_telemetry: UsageTelemetryFamily::SharedChat,
    default_plan_source: PlanSource::Deterministic,
    model_display_family: ModelDisplayFamily::ClaudeLike,
    usage_metrics_presentation: UsageMetricsPresentation::ContextWindowOnly,
}];

impl AgentParser for FutureSharedChatParser {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn capabilities(&self) -> &'static ProviderCapabilities {
        &FUTURE_PROVIDER_CAPABILITIES[0]
    }

    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType> {
        ClaudeCodeParser.parse_update_type_name(update_type)
    }

    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError> {
        ClaudeCodeParser.detect_update_type(data)
    }

    fn parse_tool_call(
        &self,
        data: &serde_json::Value,
    ) -> Result<crate::acp::session_update::ToolCallData, ParseError> {
        ClaudeCodeParser.parse_tool_call(data)
    }

    fn parse_tool_call_update(
        &self,
        data: &serde_json::Value,
        session_id: Option<&str>,
    ) -> Result<crate::acp::session_update::ToolCallUpdateData, ParseError> {
        ClaudeCodeParser.parse_tool_call_update(data, session_id)
    }

    fn parse_questions(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>> {
        ClaudeCodeParser.parse_questions(name, arguments)
    }

    fn parse_todos(&self, name: &str, arguments: &serde_json::Value) -> Option<Vec<ParsedTodo>> {
        ClaudeCodeParser.parse_todos(name, arguments)
    }

    fn detect_tool_kind(&self, name: &str) -> ToolKind {
        ClaudeCodeParser.detect_tool_kind(name)
    }

    fn parse_typed_tool_arguments(
        &self,
        tool_name: Option<&str>,
        raw_arguments: &serde_json::Value,
        kind_hint: Option<&str>,
    ) -> Option<crate::acp::session_update::ToolArguments> {
        ClaudeCodeParser.parse_typed_tool_arguments(tool_name, raw_arguments, kind_hint)
    }

    fn parse_usage_telemetry(
        &self,
        data: &serde_json::Value,
        fallback_session_id: Option<&str>,
    ) -> Result<ParsedUsageTelemetry, ParseError> {
        ClaudeCodeParser.parse_usage_telemetry(data, fallback_session_id)
    }
}

#[test]
fn future_provider_can_compose_through_descriptor_seam() {
    let descriptor =
        find_provider_capabilities_by_id(&FUTURE_PROVIDER_CAPABILITIES, "future-shared-chat")
            .expect("future provider descriptor should be discoverable");

    assert_eq!(descriptor.transport_family, TransportFamily::SharedChat);
    assert_eq!(descriptor.tool_vocabulary, ToolVocabulary::ClaudeCode);
    assert!(std::ptr::eq(descriptor.parser.capabilities(), descriptor));

    let parsed = descriptor
        .parser
        .parse_tool_call(&json!({
            "toolCallId": "tool-future-read",
            "_meta": { "claudeCode": { "toolName": "Read" } },
            "rawInput": { "file_path": "/tmp/future.md" },
            "status": "pending"
        }))
        .expect("future provider should parse through the shared-chat stack");

    assert_eq!(parsed.kind, Some(ToolKind::Read));
    assert_eq!(parsed.status, ToolCallStatus::Pending);
}

#[test]
fn future_custom_provider_can_register_without_central_default_policy_edits() {
    let registry = AgentRegistry::new();
    registry
        .register_custom(CustomAgentConfig {
            id: "future-shared-chat".to_string(),
            name: "Future Shared Chat".to_string(),
            command: "sh".to_string(),
            args: vec![],
            env: HashMap::new(),
        })
        .expect("future provider should register");

    let future = registry
        .list_all_for_ui()
        .into_iter()
        .find(|agent| agent.id == "future-shared-chat")
        .expect("future provider should be listed");

    assert_eq!(future.default_selection_rank, None);
}
