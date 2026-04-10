//! Authoritative provider -> capability composition registry.

use crate::acp::model_display::{ModelDisplayFamily, UsageMetricsPresentation};
use crate::acp::parsers::types::{AgentParser, AgentType};
use crate::acp::parsers::{
    ClaudeCodeParser, CodexParser, CopilotParser, CursorParser, OpenCodeParser,
};
use crate::acp::provider::{
    AutonomousApplyStrategy, BackendIdentityPolicy, FrontendProviderProjection,
    FrontendVariantGroup, HistoryReplayFamily, HistoryReplayPolicy, PlanAdapterPolicy,
    PreconnectionSlashMode, SessionLifecyclePolicy,
};
use crate::acp::session_update::PlanSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportFamily {
    SharedChat,
    CursorAcp,
    CodexAcp,
    OpenCodeEvents,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolVocabulary {
    ClaudeCode,
    Copilot,
    Cursor,
    Codex,
    OpenCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvocationEnrichment {
    pub parsed_cmd_recovery: bool,
    pub non_destructive_path_hints: bool,
    pub nested_argument_merge: bool,
    pub location_path_hint: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditNormalization {
    ClaudeCode,
    Copilot,
    Cursor,
    Codex,
    OpenCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageTelemetryFamily {
    SharedChat,
    Standard,
}

pub struct ProviderCapabilities {
    pub provider_id: &'static str,
    pub agent: AgentType,
    pub parser: &'static dyn AgentParser,
    pub backend_identity_policy: BackendIdentityPolicy,
    pub session_lifecycle_policy: SessionLifecyclePolicy,
    pub plan_adapter_policy: PlanAdapterPolicy,
    pub history_replay_policy: HistoryReplayPolicy,
    pub frontend_projection: FrontendProviderProjection,
    pub transport_family: TransportFamily,
    pub tool_vocabulary: ToolVocabulary,
    pub invocation_enrichment: InvocationEnrichment,
    pub edit_normalization: EditNormalization,
    pub usage_telemetry: UsageTelemetryFamily,
    pub default_plan_source: PlanSource,
    pub model_display_family: ModelDisplayFamily,
    pub usage_metrics_presentation: UsageMetricsPresentation,
}

const NO_ENRICHMENT: InvocationEnrichment = InvocationEnrichment {
    parsed_cmd_recovery: false,
    non_destructive_path_hints: false,
    nested_argument_merge: false,
    location_path_hint: false,
};

const CURSOR_ENRICHMENT: InvocationEnrichment = InvocationEnrichment {
    parsed_cmd_recovery: false,
    non_destructive_path_hints: true,
    nested_argument_merge: false,
    location_path_hint: true,
};

const CODEX_ENRICHMENT: InvocationEnrichment = InvocationEnrichment {
    parsed_cmd_recovery: true,
    non_destructive_path_hints: true,
    nested_argument_merge: true,
    location_path_hint: false,
};

const GENERIC_BACKEND_IDENTITY_POLICY: BackendIdentityPolicy = BackendIdentityPolicy {
    requires_persisted_provider_session_id: false,
    prefers_incoming_provider_session_id_alias: false,
};

const CLAUDE_BACKEND_IDENTITY_POLICY: BackendIdentityPolicy = BackendIdentityPolicy {
    requires_persisted_provider_session_id: true,
    prefers_incoming_provider_session_id_alias: true,
};

const DEFAULT_LIFECYCLE_POLICY: SessionLifecyclePolicy = SessionLifecyclePolicy {
    requires_post_connect_execution_profile_reset: true,
};

const CLAUDE_LIFECYCLE_POLICY: SessionLifecyclePolicy = SessionLifecyclePolicy {
    requires_post_connect_execution_profile_reset: false,
};

const DEFAULT_PLAN_ADAPTER_POLICY: PlanAdapterPolicy = PlanAdapterPolicy {
    parses_wrapper_plan_from_text_stream: false,
    finalizes_wrapper_plan_on_turn_end: false,
    clears_message_tracker_on_prompt_response: false,
};

const CODEX_PLAN_ADAPTER_POLICY: PlanAdapterPolicy = PlanAdapterPolicy {
    parses_wrapper_plan_from_text_stream: true,
    finalizes_wrapper_plan_on_turn_end: true,
    clears_message_tracker_on_prompt_response: true,
};

const PROVIDER_OWNED_HISTORY_REPLAY_POLICY: HistoryReplayPolicy = HistoryReplayPolicy {
    family: HistoryReplayFamily::ProviderOwned,
};

static PROVIDER_CAPABILITIES: [ProviderCapabilities; 5] = [
    ProviderCapabilities {
        provider_id: "claude-code",
        agent: AgentType::ClaudeCode,
        parser: &ClaudeCodeParser,
        backend_identity_policy: CLAUDE_BACKEND_IDENTITY_POLICY,
        session_lifecycle_policy: CLAUDE_LIFECYCLE_POLICY,
        plan_adapter_policy: DEFAULT_PLAN_ADAPTER_POLICY,
        history_replay_policy: PROVIDER_OWNED_HISTORY_REPLAY_POLICY,
        frontend_projection: FrontendProviderProjection {
            provider_brand: "claude-code",
            display_name: "Claude Code",
            display_order: 10,
            supports_model_defaults: true,
            variant_group: FrontendVariantGroup::Plain,
            default_alias: Some("default"),
            reasoning_effort_support: false,
            autonomous_apply_strategy: AutonomousApplyStrategy::LaunchProfile,
            preconnection_slash_mode: PreconnectionSlashMode::StartupGlobal,
        },
        transport_family: TransportFamily::SharedChat,
        tool_vocabulary: ToolVocabulary::ClaudeCode,
        invocation_enrichment: NO_ENRICHMENT,
        edit_normalization: EditNormalization::ClaudeCode,
        usage_telemetry: UsageTelemetryFamily::SharedChat,
        default_plan_source: PlanSource::Deterministic,
        model_display_family: ModelDisplayFamily::ClaudeLike,
        usage_metrics_presentation: UsageMetricsPresentation::ContextWindowOnly,
    },
    ProviderCapabilities {
        provider_id: "copilot",
        agent: AgentType::Copilot,
        parser: &CopilotParser,
        backend_identity_policy: GENERIC_BACKEND_IDENTITY_POLICY,
        session_lifecycle_policy: DEFAULT_LIFECYCLE_POLICY,
        plan_adapter_policy: DEFAULT_PLAN_ADAPTER_POLICY,
        history_replay_policy: PROVIDER_OWNED_HISTORY_REPLAY_POLICY,
        frontend_projection: FrontendProviderProjection {
            provider_brand: "copilot",
            display_name: "GitHub Copilot",
            display_order: 30,
            supports_model_defaults: false,
            variant_group: FrontendVariantGroup::Plain,
            default_alias: None,
            reasoning_effort_support: false,
            autonomous_apply_strategy: AutonomousApplyStrategy::PostConnect,
            preconnection_slash_mode: PreconnectionSlashMode::ProjectScoped,
        },
        transport_family: TransportFamily::SharedChat,
        tool_vocabulary: ToolVocabulary::Copilot,
        invocation_enrichment: NO_ENRICHMENT,
        edit_normalization: EditNormalization::Copilot,
        usage_telemetry: UsageTelemetryFamily::SharedChat,
        default_plan_source: PlanSource::Deterministic,
        model_display_family: ModelDisplayFamily::ClaudeLike,
        usage_metrics_presentation: UsageMetricsPresentation::SpendAndContext,
    },
    ProviderCapabilities {
        provider_id: "opencode",
        agent: AgentType::OpenCode,
        parser: &OpenCodeParser,
        backend_identity_policy: GENERIC_BACKEND_IDENTITY_POLICY,
        session_lifecycle_policy: DEFAULT_LIFECYCLE_POLICY,
        plan_adapter_policy: DEFAULT_PLAN_ADAPTER_POLICY,
        history_replay_policy: PROVIDER_OWNED_HISTORY_REPLAY_POLICY,
        frontend_projection: FrontendProviderProjection {
            provider_brand: "opencode",
            display_name: "OpenCode",
            display_order: 40,
            supports_model_defaults: true,
            variant_group: FrontendVariantGroup::Plain,
            default_alias: None,
            reasoning_effort_support: false,
            autonomous_apply_strategy: AutonomousApplyStrategy::PostConnect,
            preconnection_slash_mode: PreconnectionSlashMode::ProjectScoped,
        },
        transport_family: TransportFamily::OpenCodeEvents,
        tool_vocabulary: ToolVocabulary::OpenCode,
        invocation_enrichment: NO_ENRICHMENT,
        edit_normalization: EditNormalization::OpenCode,
        usage_telemetry: UsageTelemetryFamily::Standard,
        default_plan_source: PlanSource::Heuristic,
        model_display_family: ModelDisplayFamily::ProviderGrouped,
        usage_metrics_presentation: UsageMetricsPresentation::SpendAndContext,
    },
    ProviderCapabilities {
        provider_id: "cursor",
        agent: AgentType::Cursor,
        parser: &CursorParser,
        backend_identity_policy: GENERIC_BACKEND_IDENTITY_POLICY,
        session_lifecycle_policy: DEFAULT_LIFECYCLE_POLICY,
        plan_adapter_policy: DEFAULT_PLAN_ADAPTER_POLICY,
        history_replay_policy: PROVIDER_OWNED_HISTORY_REPLAY_POLICY,
        frontend_projection: FrontendProviderProjection {
            provider_brand: "cursor",
            display_name: "Cursor",
            display_order: 20,
            supports_model_defaults: true,
            variant_group: FrontendVariantGroup::Plain,
            default_alias: Some("auto"),
            reasoning_effort_support: false,
            autonomous_apply_strategy: AutonomousApplyStrategy::PostConnect,
            preconnection_slash_mode: PreconnectionSlashMode::StartupGlobal,
        },
        transport_family: TransportFamily::CursorAcp,
        tool_vocabulary: ToolVocabulary::Cursor,
        invocation_enrichment: CURSOR_ENRICHMENT,
        edit_normalization: EditNormalization::Cursor,
        usage_telemetry: UsageTelemetryFamily::Standard,
        default_plan_source: PlanSource::Deterministic,
        model_display_family: ModelDisplayFamily::ProviderGrouped,
        usage_metrics_presentation: UsageMetricsPresentation::SpendAndContext,
    },
    ProviderCapabilities {
        provider_id: "codex",
        agent: AgentType::Codex,
        parser: &CodexParser,
        backend_identity_policy: GENERIC_BACKEND_IDENTITY_POLICY,
        session_lifecycle_policy: DEFAULT_LIFECYCLE_POLICY,
        plan_adapter_policy: CODEX_PLAN_ADAPTER_POLICY,
        history_replay_policy: PROVIDER_OWNED_HISTORY_REPLAY_POLICY,
        frontend_projection: FrontendProviderProjection {
            provider_brand: "codex",
            display_name: "Codex",
            display_order: 50,
            supports_model_defaults: true,
            variant_group: FrontendVariantGroup::ReasoningEffort,
            default_alias: None,
            reasoning_effort_support: true,
            autonomous_apply_strategy: AutonomousApplyStrategy::PostConnect,
            preconnection_slash_mode: PreconnectionSlashMode::StartupGlobal,
        },
        transport_family: TransportFamily::CodexAcp,
        tool_vocabulary: ToolVocabulary::Codex,
        invocation_enrichment: CODEX_ENRICHMENT,
        edit_normalization: EditNormalization::Codex,
        usage_telemetry: UsageTelemetryFamily::Standard,
        default_plan_source: PlanSource::Heuristic,
        model_display_family: ModelDisplayFamily::CodexReasoningEffort,
        usage_metrics_presentation: UsageMetricsPresentation::SpendAndContext,
    },
];

pub fn all_provider_capabilities() -> &'static [ProviderCapabilities] {
    &PROVIDER_CAPABILITIES
}

pub fn find_provider_capabilities_by_id<'a>(
    capabilities: &'a [ProviderCapabilities],
    provider_id: &str,
) -> Option<&'a ProviderCapabilities> {
    capabilities
        .iter()
        .find(|capabilities| capabilities.provider_id == provider_id)
}

pub fn provider_capabilities(agent: AgentType) -> &'static ProviderCapabilities {
    find_provider_capabilities_by_id(all_provider_capabilities(), agent.as_str())
        .expect("built-in parser capabilities must exist")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::get_parser;

    #[test]
    fn provider_capabilities_registry_is_authoritative_for_get_parser() {
        for capabilities in all_provider_capabilities() {
            assert_eq!(capabilities.provider_id, capabilities.agent.as_str());
            assert_eq!(capabilities.parser.agent_type(), capabilities.agent);
            assert_eq!(
                get_parser(capabilities.agent).agent_type(),
                capabilities.agent
            );
            assert!(std::ptr::eq(
                get_parser(capabilities.agent),
                capabilities.parser
            ));
            assert!(std::ptr::eq(
                get_parser(capabilities.agent).capabilities(),
                capabilities
            ));
        }
    }

    #[test]
    fn provider_capabilities_capture_invocation_enrichment_shape() {
        let cursor = provider_capabilities(AgentType::Cursor);
        assert_eq!(cursor.transport_family, TransportFamily::CursorAcp);
        assert!(cursor.invocation_enrichment.non_destructive_path_hints);
        assert!(cursor.invocation_enrichment.location_path_hint);
        assert!(!cursor.invocation_enrichment.parsed_cmd_recovery);

        let codex = provider_capabilities(AgentType::Codex);
        assert_eq!(codex.transport_family, TransportFamily::CodexAcp);
        assert!(codex.invocation_enrichment.parsed_cmd_recovery);
        assert!(codex.invocation_enrichment.non_destructive_path_hints);
        assert!(codex.invocation_enrichment.nested_argument_merge);
        assert!(!codex.invocation_enrichment.location_path_hint);
    }

    #[test]
    fn provider_capabilities_capture_plan_and_presentation_defaults() {
        let claude = provider_capabilities(AgentType::ClaudeCode);
        assert_eq!(claude.default_plan_source, PlanSource::Deterministic);
        assert_eq!(claude.model_display_family, ModelDisplayFamily::ClaudeLike);
        assert_eq!(
            claude.usage_metrics_presentation,
            UsageMetricsPresentation::ContextWindowOnly
        );

        let codex = provider_capabilities(AgentType::Codex);
        assert_eq!(codex.default_plan_source, PlanSource::Heuristic);
        assert_eq!(
            codex.model_display_family,
            ModelDisplayFamily::CodexReasoningEffort
        );
    }

    #[test]
    fn provider_capabilities_capture_identity_and_lifecycle_policy() {
        let claude = provider_capabilities(AgentType::ClaudeCode);
        assert!(
            claude
                .backend_identity_policy
                .requires_persisted_provider_session_id
        );
        assert!(
            claude
                .backend_identity_policy
                .prefers_incoming_provider_session_id_alias
        );
        assert!(
            !claude
                .session_lifecycle_policy
                .requires_post_connect_execution_profile_reset
        );

        let cursor = provider_capabilities(AgentType::Cursor);
        assert!(
            !cursor
                .backend_identity_policy
                .requires_persisted_provider_session_id
        );
        assert!(
            cursor
                .session_lifecycle_policy
                .requires_post_connect_execution_profile_reset
        );
    }

    #[test]
    fn provider_capabilities_capture_plan_and_frontend_projection_contracts() {
        let codex = provider_capabilities(AgentType::Codex);
        assert!(
            codex
                .plan_adapter_policy
                .parses_wrapper_plan_from_text_stream
        );
        assert!(codex.plan_adapter_policy.finalizes_wrapper_plan_on_turn_end);
        assert!(
            codex
                .plan_adapter_policy
                .clears_message_tracker_on_prompt_response
        );
        assert_eq!(
            codex.frontend_projection.variant_group,
            FrontendVariantGroup::ReasoningEffort
        );
        assert!(codex.frontend_projection.reasoning_effort_support);

        let copilot = provider_capabilities(AgentType::Copilot);
        assert_eq!(copilot.frontend_projection.display_name, "GitHub Copilot");
        assert!(!copilot.frontend_projection.supports_model_defaults);
        assert_eq!(
            copilot.frontend_projection.autonomous_apply_strategy,
            AutonomousApplyStrategy::PostConnect
        );
    }
}
