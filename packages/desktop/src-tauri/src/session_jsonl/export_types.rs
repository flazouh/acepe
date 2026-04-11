// Module to export TypeScript types from Rust types using specta
// Run: cargo test --lib session_jsonl::export_types::tests::export_types

use crate::acp::client::{
    AvailableMode, AvailableModel, NewSessionResponse, ResumeSessionResponse, SessionModelState,
    SessionModes,
};
use crate::acp::domain_events::{SessionDomainEvent, SessionDomainEventKind};
use crate::acp::model_display::{
    DisplayModelGroup, DisplayableModel, ModelDisplayFamily, ModelPresentationMetadata,
    ModelsForDisplay, UsageMetricsPresentation,
};
use crate::acp::projections::{
    InteractionKind, InteractionPayload, InteractionResponse, InteractionSnapshot,
    InteractionState, OperationSnapshot, PlanApprovalSource, SessionProjectionSnapshot,
    SessionSnapshot, SessionTurnState,
};
use crate::acp::session_update::{
    AvailableCommand, AvailableCommandsData, ChunkAggregationHint, CommandInput, ConfigOptionData,
    ConfigOptionUpdateData, ConfigOptionValue, ContentChunk, CurrentModeData, EditEntry,
    InteractionReplyHandler, InteractionReplyHandlerKind, PermissionData, PlanConfidence, PlanData,
    PlanSource, PlanStep, PlanStepStatus, QuestionData, QuestionItem, QuestionOption,
    SessionUpdate, SkillMeta, TodoItem, TodoStatus, ToolArguments, ToolCallData, ToolCallLocation,
    ToolCallStatus, ToolCallUpdateData, ToolKind, ToolReference, TurnErrorData, TurnErrorInfo,
    TurnErrorKind, TurnErrorSource, UsageTelemetryData, UsageTelemetryTokens,
};
use crate::acp::types::{CanonicalAgentId, ContentBlock, EmbeddedResource};
use crate::checkpoint::types::FileDiffContent;
use crate::db::repository::SessionLifecycleState;
use crate::file_index::types::{
    FileExplorerPreviewResponse, FileExplorerRow, FileExplorerSearchResponse, FileGitStatus,
    IndexedFile, PreviewKind, ProjectIndex,
};
use crate::session_jsonl::types::*;
use crate::storage::types::UserSettingKey;
use specta_typescript::Typescript;
use std::fs;
use std::path::Path;

const CONVERTED_SESSION_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/converted-session-types.ts";
const CLAUDE_HISTORY_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/claude-history-types.ts";
const ACP_TYPES_PATH: &str = "../../../packages/desktop/src/lib/services/acp-types.ts";
const CHECKPOINT_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/checkpoint-types.ts";
const ACP_TYPES_COMPAT_HELPERS: &str = r#"
export type ProviderBrand = "claude-code" | "copilot" | "cursor" | "opencode" | "codex" | "custom";

export type ProviderVariantGroup = "plain" | "reasoningEffort";

export type PreconnectionSlashMode = "startupGlobal" | "projectScoped" | "unsupported";

export type ProviderMetadataProjection = {
	providerBrand: ProviderBrand;
	displayName: string;
	displayOrder: number;
	supportsModelDefaults: boolean;
	variantGroup: ProviderVariantGroup;
	defaultAlias?: string;
	reasoningEffortSupport: boolean;
	preconnectionSlashMode: PreconnectionSlashMode;
};

export type ModelsForDisplayWithProvider = ModelsForDisplay;

export const BUILTIN_PROVIDER_METADATA_BY_AGENT_ID: Record<string, ProviderMetadataProjection> = {
	"claude-code": {
		providerBrand: "claude-code",
		displayName: "Claude Code",
		displayOrder: 10,
		supportsModelDefaults: true,
		variantGroup: "plain",
		defaultAlias: "default",
		reasoningEffortSupport: false,
		preconnectionSlashMode: "startupGlobal",
	},
	copilot: {
		providerBrand: "copilot",
		displayName: "GitHub Copilot",
		displayOrder: 30,
		supportsModelDefaults: false,
		variantGroup: "plain",
		defaultAlias: undefined,
		reasoningEffortSupport: false,
		preconnectionSlashMode: "projectScoped",
	},
	cursor: {
		providerBrand: "cursor",
		displayName: "Cursor",
		displayOrder: 20,
		supportsModelDefaults: true,
		variantGroup: "plain",
		defaultAlias: "auto",
		reasoningEffortSupport: false,
		preconnectionSlashMode: "startupGlobal",
	},
	opencode: {
		providerBrand: "opencode",
		displayName: "OpenCode",
		displayOrder: 40,
		supportsModelDefaults: true,
		variantGroup: "plain",
		defaultAlias: undefined,
		reasoningEffortSupport: false,
		preconnectionSlashMode: "projectScoped",
	},
	codex: {
		providerBrand: "codex",
		displayName: "Codex",
		displayOrder: 50,
		supportsModelDefaults: true,
		variantGroup: "reasoningEffort",
		defaultAlias: undefined,
		reasoningEffortSupport: true,
		preconnectionSlashMode: "startupGlobal",
	},
};

function cloneProviderMetadataProjection(
	providerMetadata: ProviderMetadataProjection
): ProviderMetadataProjection {
	return {
		providerBrand: providerMetadata.providerBrand,
		displayName: providerMetadata.displayName,
		displayOrder: providerMetadata.displayOrder,
		supportsModelDefaults: providerMetadata.supportsModelDefaults,
		variantGroup: providerMetadata.variantGroup,
		defaultAlias: providerMetadata.defaultAlias,
		reasoningEffortSupport: providerMetadata.reasoningEffortSupport,
		preconnectionSlashMode: providerMetadata.preconnectionSlashMode,
	};
}

export function resolveProviderMetadataProjection(
	agentId: string,
	providerMetadata: ProviderMetadataProjection | null | undefined,
	fallbackDisplayName?: string
): ProviderMetadataProjection {
	if (providerMetadata) {
		return cloneProviderMetadataProjection(providerMetadata);
	}

	const builtInProviderMetadata = BUILTIN_PROVIDER_METADATA_BY_AGENT_ID[agentId];
	if (builtInProviderMetadata) {
		return cloneProviderMetadataProjection(builtInProviderMetadata);
	}

	return {
		providerBrand: "custom",
		displayName: fallbackDisplayName ?? agentId,
		displayOrder: 65535,
		supportsModelDefaults: false,
		variantGroup: "plain",
		defaultAlias: undefined,
		reasoningEffortSupport: false,
		preconnectionSlashMode: "unsupported",
	};
}

export function getProviderMetadataFromModelsDisplay(
	modelsDisplay: ModelsForDisplay | null | undefined
): ProviderMetadataProjection | null {
	return modelsDisplay?.presentation?.provider ?? null;
}

export function normalizeModelsForDisplay(
	agentId: string,
	modelsDisplay: ModelsForDisplay | null | undefined,
	fallbackDisplayName?: string,
	providerMetadataOverride?: ProviderMetadataProjection | null
): ModelsForDisplay | null {
	if (!modelsDisplay) {
		return null;
	}

	const providerMetadata = resolveProviderMetadataProjection(
		agentId,
		providerMetadataOverride ?? getProviderMetadataFromModelsDisplay(modelsDisplay),
		fallbackDisplayName
	);
	const presentation = modelsDisplay.presentation;
	const displayFamily =
		presentation?.displayFamily ??
		(providerMetadata.variantGroup === "reasoningEffort"
			? "codexReasoningEffort"
			: "providerGrouped");

	return {
		groups: modelsDisplay.groups,
		presentation: {
			displayFamily,
			usageMetrics: presentation?.usageMetrics ?? "spendAndContext",
			provider: providerMetadata,
		},
	};
}
"#;

/// Creates a specta configuration that allows BigInt for i64 types
fn ts_config() -> Typescript {
    Typescript::default().bigint(specta_typescript::BigIntExportBehavior::Number)
}

/// Exports all TypeScript types for session_jsonl module
pub fn export_all_types() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let config = ts_config();

    // Export CanonicalAgentId first (dependency of HistoryEntry)
    let canonical_agent_id_type = specta_typescript::export::<CanonicalAgentId>(&config)
        .expect("Failed to export CanonicalAgentId");
    let session_lifecycle_state_type = specta_typescript::export::<SessionLifecycleState>(&config)
        .expect("Failed to export SessionLifecycleState");

    // Export HistoryEntry to claude-history-types.ts
    let history_types =
        specta_typescript::export::<HistoryEntry>(&config).expect("Failed to export HistoryEntry");
    let startup_sessions_response_type =
        specta_typescript::export::<StartupSessionsResponse>(&config)
            .expect("Failed to export StartupSessionsResponse");
    let history_output = format!(
        "// This file was generated by specta. Do not edit this file manually.\n\n// JsonValue represents any valid JSON value\nexport type JsonValue = null | boolean | number | string | JsonValue[] | {{ [key: string]: JsonValue }};\n\n{}\n\n{}\n\n{}\n\n{}\n",
        canonical_agent_id_type, session_lifecycle_state_type, history_types, startup_sessions_response_type
    );
    let history_path = Path::new(manifest_dir).join(CLAUDE_HISTORY_TYPES_PATH);
    fs::write(&history_path, history_output).expect("Failed to write claude-history-types.ts");
    eprintln!("Exported HistoryEntry to {}", history_path.display());

    // Export ConvertedSession types to converted-session-types.ts
    let mut converted_types = String::from(
        "// This file was generated by specta. Do not edit this file manually.\n\n// JsonValue represents any valid JSON value\nexport type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };\n\n",
    );

    macro_rules! export_type {
        ($ty:ty) => {
            converted_types.push_str(
                &specta_typescript::export::<$ty>(&config)
                    .expect(concat!("Failed to export ", stringify!($ty))),
            );
            converted_types.push_str("\n\n");
        };
    }

    // Export in dependency order
    // Session update types (UsageTelemetry* before SessionUpdate which references them)
    export_type!(UsageTelemetryTokens);
    export_type!(UsageTelemetryData);
    export_type!(SessionUpdate);
    export_type!(ChunkAggregationHint);
    export_type!(ContentChunk);
    export_type!(ToolCallData);
    export_type!(EditEntry);
    export_type!(ToolArguments);
    export_type!(ToolCallUpdateData);
    export_type!(PlanData);
    export_type!(AvailableCommandsData);
    export_type!(CurrentModeData);
    export_type!(ConfigOptionUpdateData);
    export_type!(ConfigOptionData);
    export_type!(ConfigOptionValue);
    export_type!(InteractionReplyHandlerKind);
    export_type!(InteractionReplyHandler);
    export_type!(PermissionData);
    export_type!(QuestionData);
    export_type!(TurnErrorData);
    export_type!(TurnErrorInfo);
    export_type!(TurnErrorKind);
    export_type!(TurnErrorSource);
    // Supporting types
    export_type!(EmbeddedResource);
    export_type!(PlanStep);
    export_type!(PlanStepStatus);
    export_type!(PlanSource);
    export_type!(PlanConfidence);
    export_type!(ToolKind);
    export_type!(ToolCallStatus);
    export_type!(ToolCallLocation);
    export_type!(AvailableCommand);
    export_type!(CommandInput);
    export_type!(ToolReference);
    export_type!(QuestionOption);
    export_type!(QuestionItem);
    export_type!(TodoStatus);
    export_type!(TodoItem);
    // SkillMeta is included in ToolCallData, so we don't export it separately

    export_type!(SessionStats);
    export_type!(TokenUsage);
    export_type!(ContentBlock);
    export_type!(OrderedMessage);
    export_type!(FullSession);
    export_type!(StoredContentBlock);
    export_type!(StoredAssistantChunk);
    export_type!(StoredUserMessage);
    export_type!(StoredAssistantMessage);
    export_type!(SkillMeta);
    export_type!(QuestionAnswer);
    export_type!(StoredEntry);
    export_type!(ConvertedSession);
    export_type!(SessionPlanResponse);
    export_type!(UserSettingKey);

    // File index types (for @ file picker)
    export_type!(IndexedFile);
    export_type!(FileGitStatus);
    export_type!(ProjectIndex);

    // File explorer types (for Cmd+I file explorer modal)
    export_type!(PreviewKind);
    export_type!(FileExplorerRow);
    export_type!(FileExplorerSearchResponse);
    export_type!(FileExplorerPreviewResponse);

    let converted_path = Path::new(manifest_dir).join(CONVERTED_SESSION_TYPES_PATH);
    fs::write(&converted_path, converted_types)
        .expect("Failed to write converted-session-types.ts");
    eprintln!(
        "Exported ConvertedSession types to {}",
        converted_path.display()
    );

    // Export ACP types to acp-types.ts
    let mut acp_types =
        String::from("// This file was generated by specta. Do not edit this file manually.\n\n// JsonValue represents any valid JSON value\nexport type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };\n\n");

    macro_rules! export_acp_type {
        ($ty:ty) => {
            acp_types.push_str(
                &specta_typescript::export::<$ty>(&config)
                    .expect(concat!("Failed to export ", stringify!($ty))),
            );
            acp_types.push_str("\n\n");
        };
    }

    export_acp_type!(AvailableModel);
    export_acp_type!(AvailableMode);
    export_acp_type!(CommandInput);
    export_acp_type!(AvailableCommand);
    export_acp_type!(DisplayableModel);
    export_acp_type!(DisplayModelGroup);
    export_acp_type!(ModelDisplayFamily);
    export_acp_type!(UsageMetricsPresentation);
    export_acp_type!(ModelPresentationMetadata);
    export_acp_type!(ModelsForDisplay);
    export_acp_type!(SessionModelState);
    export_acp_type!(SessionModes);
    export_acp_type!(ConfigOptionValue);
    export_acp_type!(ConfigOptionData);
    export_acp_type!(NewSessionResponse);
    export_acp_type!(ResumeSessionResponse);
    export_acp_type!(CanonicalAgentId);
    export_acp_type!(ToolKind);
    export_acp_type!(ToolCallStatus);
    export_acp_type!(ChunkAggregationHint);
    export_acp_type!(EditEntry);
    export_acp_type!(ToolArguments);
    export_acp_type!(ToolReference);
    export_acp_type!(QuestionOption);
    export_acp_type!(QuestionItem);
    export_acp_type!(InteractionReplyHandlerKind);
    export_acp_type!(InteractionReplyHandler);
    export_acp_type!(PermissionData);
    export_acp_type!(QuestionData);
    export_acp_type!(SessionDomainEventKind);
    export_acp_type!(SessionDomainEvent);
    export_acp_type!(SessionTurnState);
    export_acp_type!(SessionSnapshot);
    export_acp_type!(OperationSnapshot);
    export_acp_type!(InteractionKind);
    export_acp_type!(InteractionState);
    export_acp_type!(PlanApprovalSource);
    export_acp_type!(InteractionPayload);
    export_acp_type!(InteractionResponse);
    export_acp_type!(InteractionSnapshot);
    export_acp_type!(SessionProjectionSnapshot);

    acp_types = acp_types.replace(
        "export type ModelPresentationMetadata = { displayFamily: ModelDisplayFamily; usageMetrics: UsageMetricsPresentation }",
        "export type ModelPresentationMetadata = { displayFamily: ModelDisplayFamily; usageMetrics: UsageMetricsPresentation; provider?: ProviderMetadataProjection }",
    );
    acp_types = acp_types.replace(
        "export type SessionModelState = { availableModels?: AvailableModel[]; currentModelId?: string; modelsDisplay?: ModelsForDisplay }",
        "export type SessionModelState = { availableModels?: AvailableModel[]; currentModelId?: string; modelsDisplay?: ModelsForDisplay; providerMetadata?: ProviderMetadataProjection }",
    );

    acp_types.push_str(ACP_TYPES_COMPAT_HELPERS);
    acp_types.push('\n');

    let acp_path = Path::new(manifest_dir).join(ACP_TYPES_PATH);
    fs::write(&acp_path, acp_types).expect("Failed to write acp-types.ts");
    eprintln!("Exported ACP types to {}", acp_path.display());

    // Export checkpoint types
    let checkpoint_types = specta_typescript::export::<FileDiffContent>(&config)
        .expect("Failed to export FileDiffContent");
    let checkpoint_output = format!(
        "// This file was generated by specta. Do not edit this file manually.\n\n{}\n",
        checkpoint_types
    );
    let checkpoint_path = Path::new(manifest_dir).join(CHECKPOINT_TYPES_PATH);
    fs::write(&checkpoint_path, checkpoint_output).expect("Failed to write checkpoint-types.ts");
    eprintln!("Exported checkpoint types to {}", checkpoint_path.display());

    eprintln!("TypeScript types exported successfully");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_types() {
        export_all_types();
    }

    #[test]
    fn exports_canonical_domain_event_types_to_acp_types() {
        export_all_types();

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let acp_path = Path::new(manifest_dir).join(ACP_TYPES_PATH);
        let contents =
            fs::read_to_string(&acp_path).expect("Failed to read generated acp-types.ts");

        assert!(
            contents.contains("export type SessionDomainEvent"),
            "expected acp-types.ts to export SessionDomainEvent, but it did not"
        );
    }
}
