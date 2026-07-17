// Module to export TypeScript types from Rust types using specta
// Run: cargo test --lib session_jsonl::export_types::tests::export_types

use crate::acp::capability_resolution::{ResolvedCapabilities, ResolvedCapabilityStatus};
use crate::acp::client::{
    AvailableMode, AvailableModel, AvailableModelProvider, NewSessionResponse,
    ResumeSessionResponse, SessionModelState, SessionModes,
};
use crate::acp::client_session::ModeIconKind;
use crate::acp::commands::transcript_viewport_commands::TranscriptViewportCommandRevision;
use crate::acp::domain_events::{
    SessionDomainEvent, SessionDomainEventKind, SessionDomainEventPayload,
};
use crate::acp::lifecycle::{
    DetachedReason, FailureReason, LifecycleCheckpoint, LifecycleState, LifecycleStatus,
};
use crate::acp::mcp_catalog::{
    ComposerMcpCatalog, ComposerMcpCatalogSource, ComposerMcpConnectionStatus, ComposerMcpServer,
    ComposerMcpTool,
};
use crate::acp::model_display::{
    DisplayModelGroup, DisplayableModel, ModelDisplayFamily, ModelPresentationMetadata,
    ModelsForDisplay, UpstreamProviderBrand, UsageMetricsPresentation,
};
use crate::acp::projections::{
    ComputerOperationErrorPayload, ComputerOperationInputPayload, ComputerOperationOutputPayload,
    ComputerOperationPayload, ComputerPermissionData, InteractionKind, InteractionPayload,
    InteractionResponse, InteractionSnapshot, InteractionState, OperationDegradationCode,
    OperationDegradationReason, OperationSnapshot, OperationSourceLink, OperationState,
    PlanApprovalSource, SessionProjectionSnapshot, SessionSnapshot, SessionTurnState,
    TurnFailureSnapshot,
};
use crate::acp::session_open_snapshot::{
    SessionOpenError, SessionOpenErrorReason, SessionOpenFound, SessionOpenMissing,
    SessionOpenPath, SessionOpenPreparing, SessionOpenResult, SessionOpenResultTiming,
    SessionOpenTranscriptRowPage,
};
use crate::acp::session_state_engine::protocol::{
    AssistantTextDeltaPayload, ViewportBufferDelta, ViewportBufferDiagnostic, ViewportBufferPush,
};
use crate::acp::session_state_engine::{
    ActiveStreamingTail, ActiveStreamingTailContentKind, CapabilityPreviewState,
    SessionGraphActionability, SessionGraphActivity, SessionGraphActivityKind,
    SessionGraphCapabilities, SessionGraphLifecycle, SessionGraphRevision,
    SessionRecommendedAction, SessionRecoveryPhase, SessionStateDelta, SessionStateEnvelope,
    SessionStateField, SessionStateGraph, SessionStatePayload, SessionStateSnapshotMaterialization,
};
use crate::acp::session_update::{
    AvailableCommand, AvailableCommandsData, ChunkAggregationHint, CommandInput, ConfigOptionData,
    ConfigOptionPresentation, ConfigOptionUpdateData, ConfigOptionValue, ContentChunk,
    ContextWindowSource, CurrentModeData, EditEntry, InteractionReplyHandler,
    InteractionReplyHandlerKind, PermissionData, PlanConfidence, PlanData, PlanSource, PlanStep,
    PlanStepStatus, QuestionData, QuestionItem, QuestionOption, SessionCompactionEvent,
    SessionCompactionStatus, SessionCompactionTrigger, SessionUpdate, SkillMeta, TodoItem,
    TodoStatus, TodoUpdate, TodoUpdateOperation, ToolArguments, ToolCallData, ToolCallLocation,
    ToolCallStatus, ToolCallUpdateData, ToolKind, ToolReference, ToolSourceContext,
    ToolSourceRange, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
    UsageTelemetryData, UsageTelemetryTokens,
};
use crate::acp::transcript_projection::{
    TranscriptDelta, TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole,
    TranscriptScope, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::transcript_viewport::{
    TranscriptViewportInteractionLink, TranscriptViewportLatestChildAction,
    TranscriptViewportOperationDisplayFacts, TranscriptViewportOperationLink,
    TranscriptViewportRow, TranscriptViewportRowContent, TranscriptViewportRowKind,
};
use crate::acp::types::{CanonicalAgentId, ContentBlock, EmbeddedResource};
use crate::checkpoint::types::FileDiffContent;
use crate::computer_use::permissions::ComputerPermissionKind;
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
const SESSION_UPDATE_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/session-update-types.ts";
const USER_SETTINGS_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/user-settings-types.ts";
const FILE_INDEX_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/file-index-types.ts";
const SESSION_JSONL_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/session-jsonl-types.ts";
const CLAUDE_HISTORY_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/claude-history-types.ts";
const ACP_TYPES_PATH: &str = "../../../packages/desktop/src/lib/services/acp-types.ts";
const CHECKPOINT_TYPES_PATH: &str =
    "../../../packages/desktop/src/lib/services/checkpoint-types.ts";
const ACP_TYPES_COMPAT_HELPERS: &str = r#"
export type ProviderBrand = "claude-code" | "copilot" | "cursor" | "opencode" | "codex" | "custom";

export type ProviderVariantGroup = "plain" | "reasoningEffort";

export type PreconnectionSlashMode = "startupGlobal" | "projectScoped" | "unsupported";

export type PreconnectionCapabilityMode = "startupGlobal" | "projectScoped" | "unsupported";

export type ImplicitSessionCreationMode = "allowed" | "explicitUserAction";

export type ProviderMetadataProjection = {
	providerBrand: ProviderBrand;
	displayName: string;
	displayOrder: number;
	supportsModelDefaults: boolean;
	allowsImplicitModelSelection?: boolean;
	variantGroup: ProviderVariantGroup;
	defaultAlias?: string;
	reasoningEffortSupport: boolean;
	preconnectionSlashMode: PreconnectionSlashMode;
	preconnectionCapabilityMode: PreconnectionCapabilityMode;
	implicitSessionCreationMode: ImplicitSessionCreationMode;
};

export type FrontendProviderProjection = ProviderMetadataProjection;

export type ModelsForDisplayWithProvider = ModelsForDisplay;

export type TranscriptRowPageResult =
	({ status: "current" } & SessionOpenTranscriptRowPage)
	| { status: "missing" }
	| {
			status: "stale";
			projectionVersion: string;
			totalRowCount: number;
			transcriptRevision: number;
			graphRevision: number;
			lastEventSeq: number;
	  };
"#;

/// Creates a specta configuration that allows BigInt for i64 types
fn ts_config() -> Typescript {
    Typescript::default().bigint(specta_typescript::BigIntExportBehavior::Number)
}

fn trim_generated_trailing_whitespace(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for line in input.lines() {
        output.push_str(line.trim_end());
        output.push('\n');
    }
    if !input.ends_with('\n') {
        output.pop();
    }
    output
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
    let history_usage_stats_type = specta_typescript::export::<HistoryUsageStats>(&config)
        .expect("Failed to export HistoryUsageStats");

    // Export HistoryEntry to claude-history-types.ts
    let history_types =
        specta_typescript::export::<HistoryEntry>(&config).expect("Failed to export HistoryEntry");
    let startup_sessions_response_type =
        specta_typescript::export::<StartupSessionsResponse>(&config)
            .expect("Failed to export StartupSessionsResponse");
    let history_output = format!(
        "// This file was generated by specta. Do not edit this file manually.\n\n// JsonValue represents any valid JSON value\nexport type JsonValue = null | boolean | number | string | JsonValue[] | {{ [key: string]: JsonValue }};\n\n{}\n\n{}\n\n{}\n\n{}\n\n{}\n",
        canonical_agent_id_type,
        session_lifecycle_state_type,
        history_usage_stats_type,
        history_types,
        startup_sessions_response_type
    );
    let history_path = Path::new(manifest_dir).join(CLAUDE_HISTORY_TYPES_PATH);
    fs::write(
        &history_path,
        trim_generated_trailing_whitespace(&history_output),
    )
    .expect("Failed to write claude-history-types.ts");
    eprintln!("Exported HistoryEntry to {}", history_path.display());

    let session_update_header = String::from(
        "// This file was generated by specta. Do not edit this file manually.\n\nimport type { DetachedReason, FailureReason, SessionModelState, SessionModes, TodoUpdate, TodoUpdateOperation } from \"./acp-types.js\";\n\n// JsonValue represents any valid JSON value\nexport type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };\n\n",
    );
    let user_settings_header =
        String::from("// This file was generated by specta. Do not edit this file manually.\n\n");
    let file_index_header =
        String::from("// This file was generated by specta. Do not edit this file manually.\n\n");
    let session_jsonl_header =
        String::from("// This file was generated by specta. Do not edit this file manually.\n\n");

    let mut session_update_types = session_update_header.clone();
    let mut user_settings_types = user_settings_header.clone();
    let mut file_index_types = file_index_header.clone();
    let mut session_jsonl_types = session_jsonl_header.clone();

    macro_rules! export_session_update_type {
        ($ty:ty) => {
            session_update_types.push_str(
                &specta_typescript::export::<$ty>(&config)
                    .expect(concat!("Failed to export ", stringify!($ty))),
            );
            session_update_types.push_str("\n\n");
        };
    }

    macro_rules! export_user_settings_type {
        ($ty:ty) => {
            user_settings_types.push_str(
                &specta_typescript::export::<$ty>(&config)
                    .expect(concat!("Failed to export ", stringify!($ty))),
            );
            user_settings_types.push_str("\n\n");
        };
    }

    macro_rules! export_file_index_type {
        ($ty:ty) => {
            file_index_types.push_str(
                &specta_typescript::export::<$ty>(&config)
                    .expect(concat!("Failed to export ", stringify!($ty))),
            );
            file_index_types.push_str("\n\n");
        };
    }

    macro_rules! export_session_jsonl_type {
        ($ty:ty) => {
            session_jsonl_types.push_str(
                &specta_typescript::export::<$ty>(&config)
                    .expect(concat!("Failed to export ", stringify!($ty))),
            );
            session_jsonl_types.push_str("\n\n");
        };
    }

    // Session update types (UsageTelemetry* before SessionUpdate which references them)
    export_session_update_type!(UsageTelemetryTokens);
    export_session_update_type!(ContextWindowSource);
    export_session_update_type!(UsageTelemetryData);
    export_session_update_type!(SessionCompactionStatus);
    export_session_update_type!(SessionCompactionTrigger);
    export_session_update_type!(SessionCompactionEvent);
    export_session_update_type!(SessionUpdate);
    export_session_update_type!(ChunkAggregationHint);
    export_session_update_type!(ContentChunk);
    export_session_update_type!(ToolCallData);
    export_session_update_type!(EditEntry);
    export_session_update_type!(ToolSourceRange);
    export_session_update_type!(ToolSourceContext);
    export_session_update_type!(ToolArguments);
    export_session_update_type!(ToolCallUpdateData);
    export_session_update_type!(PlanData);
    export_session_update_type!(AvailableCommandsData);
    export_session_update_type!(CurrentModeData);
    export_session_update_type!(ConfigOptionUpdateData);
    export_session_update_type!(ConfigOptionPresentation);
    export_session_update_type!(ConfigOptionData);
    export_session_update_type!(ConfigOptionValue);
    export_session_update_type!(InteractionReplyHandlerKind);
    export_session_update_type!(InteractionReplyHandler);
    export_session_update_type!(PermissionData);
    export_session_update_type!(QuestionData);
    export_session_update_type!(TurnErrorData);
    export_session_update_type!(TurnErrorInfo);
    export_session_update_type!(TurnErrorKind);
    export_session_update_type!(TurnErrorSource);
    export_session_update_type!(EmbeddedResource);
    export_session_update_type!(PlanStep);
    export_session_update_type!(PlanStepStatus);
    export_session_update_type!(PlanSource);
    export_session_update_type!(PlanConfidence);
    export_session_update_type!(ToolKind);
    export_session_update_type!(ToolCallStatus);
    export_session_update_type!(ToolCallLocation);
    export_session_update_type!(AvailableCommand);
    export_session_update_type!(CommandInput);
    export_session_update_type!(ToolReference);
    export_session_update_type!(QuestionOption);
    export_session_update_type!(QuestionItem);
    export_session_update_type!(TodoStatus);
    export_session_update_type!(TodoItem);
    export_session_update_type!(ContentBlock);
    export_session_update_type!(SkillMeta);
    export_session_update_type!(QuestionAnswer);
    export_session_update_type!(StoredErrorMessage);

    export_user_settings_type!(UserSettingKey);

    export_session_jsonl_type!(SessionPlanResponse);

    export_file_index_type!(IndexedFile);
    export_file_index_type!(FileGitStatus);
    export_file_index_type!(ProjectIndex);
    export_file_index_type!(PreviewKind);
    export_file_index_type!(FileExplorerRow);
    export_file_index_type!(FileExplorerSearchResponse);
    export_file_index_type!(FileExplorerPreviewResponse);

    let session_update_path = Path::new(manifest_dir).join(SESSION_UPDATE_TYPES_PATH);
    fs::write(
        &session_update_path,
        trim_generated_trailing_whitespace(&session_update_types),
    )
    .expect("Failed to write session-update-types.ts");
    eprintln!(
        "Exported session update types to {}",
        session_update_path.display()
    );

    let user_settings_path = Path::new(manifest_dir).join(USER_SETTINGS_TYPES_PATH);
    fs::write(
        &user_settings_path,
        trim_generated_trailing_whitespace(&user_settings_types),
    )
    .expect("Failed to write user-settings-types.ts");
    eprintln!(
        "Exported user settings types to {}",
        user_settings_path.display()
    );

    let file_index_path = Path::new(manifest_dir).join(FILE_INDEX_TYPES_PATH);
    fs::write(
        &file_index_path,
        trim_generated_trailing_whitespace(&file_index_types),
    )
    .expect("Failed to write file-index-types.ts");
    eprintln!("Exported file index types to {}", file_index_path.display());

    let session_jsonl_path = Path::new(manifest_dir).join(SESSION_JSONL_TYPES_PATH);
    fs::write(
        &session_jsonl_path,
        trim_generated_trailing_whitespace(&session_jsonl_types),
    )
    .expect("Failed to write session-jsonl-types.ts");
    eprintln!(
        "Exported session jsonl types to {}",
        session_jsonl_path.display()
    );

    let converted_output = format!(
        "// This file was generated by specta. Do not edit this file manually.\n\nexport type * from \"./session-update-types.js\";\nexport type * from \"./user-settings-types.js\";\nexport type * from \"./file-index-types.js\";\nexport type * from \"./session-jsonl-types.js\";\n",
    );
    let converted_path = Path::new(manifest_dir).join(CONVERTED_SESSION_TYPES_PATH);
    fs::write(
        &converted_path,
        trim_generated_trailing_whitespace(&converted_output),
    )
    .expect("Failed to write converted-session-types.ts");
    eprintln!(
        "Exported converted-session-types barrel to {}",
        converted_path.display()
    );

    // Export ACP types to acp-types.ts
    let mut acp_types = String::from(
        "// This file was generated by specta. Do not edit this file manually.\n\n// JsonValue represents any valid JSON value\nexport type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };\n\n",
    );

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
    export_acp_type!(AvailableModelProvider);
    export_acp_type!(ModeIconKind);
    export_acp_type!(AvailableMode);
    export_acp_type!(CommandInput);
    export_acp_type!(AvailableCommand);
    export_acp_type!(ComposerMcpCatalogSource);
    export_acp_type!(ComposerMcpConnectionStatus);
    export_acp_type!(ComposerMcpTool);
    export_acp_type!(ComposerMcpServer);
    export_acp_type!(ComposerMcpCatalog);
    export_acp_type!(DisplayableModel);
    export_acp_type!(DisplayModelGroup);
    export_acp_type!(UpstreamProviderBrand);
    export_acp_type!(ModelDisplayFamily);
    export_acp_type!(UsageMetricsPresentation);
    export_acp_type!(ModelPresentationMetadata);
    export_acp_type!(ModelsForDisplay);
    export_acp_type!(SessionModelState);
    export_acp_type!(SessionModes);
    export_acp_type!(ResolvedCapabilityStatus);
    export_acp_type!(ResolvedCapabilities);
    export_acp_type!(ConfigOptionPresentation);
    export_acp_type!(ConfigOptionValue);
    export_acp_type!(ConfigOptionData);
    export_acp_type!(NewSessionResponse);
    export_acp_type!(ResumeSessionResponse);
    export_acp_type!(CanonicalAgentId);
    export_acp_type!(ToolKind);
    export_acp_type!(ToolCallStatus);
    export_acp_type!(ChunkAggregationHint);
    export_acp_type!(EditEntry);
    export_acp_type!(ToolSourceRange);
    export_acp_type!(ToolSourceContext);
    export_acp_type!(ToolArguments);
    export_acp_type!(ToolReference);
    export_acp_type!(QuestionOption);
    export_acp_type!(QuestionItem);
    export_acp_type!(InteractionReplyHandlerKind);
    export_acp_type!(InteractionReplyHandler);
    export_acp_type!(PermissionData);
    export_acp_type!(QuestionData);
    export_acp_type!(ContextWindowSource);
    export_acp_type!(UsageTelemetryData);
    export_acp_type!(UsageTelemetryTokens);
    export_acp_type!(SessionCompactionStatus);
    export_acp_type!(SessionCompactionTrigger);
    export_acp_type!(SessionCompactionEvent);
    export_acp_type!(PlanStepStatus);
    export_acp_type!(PlanStep);
    export_acp_type!(PlanSource);
    export_acp_type!(PlanConfidence);
    export_acp_type!(PlanData);
    export_acp_type!(TodoStatus);
    export_acp_type!(TodoItem);
    export_acp_type!(TodoUpdateOperation);
    export_acp_type!(TodoUpdate);
    export_acp_type!(TranscriptEntryRole);
    export_acp_type!(TranscriptScope);
    export_acp_type!(TranscriptSegment);
    export_acp_type!(TranscriptEntry);
    export_acp_type!(TranscriptSnapshot);
    export_acp_type!(TranscriptDeltaOperation);
    export_acp_type!(TranscriptDelta);
    export_acp_type!(SessionDomainEventKind);
    export_acp_type!(SessionDomainEventPayload);
    export_acp_type!(SessionDomainEvent);
    export_acp_type!(ToolCallLocation);
    export_acp_type!(SkillMeta);
    export_acp_type!(QuestionAnswer);
    export_acp_type!(SessionTurnState);
    export_acp_type!(SessionSnapshot);
    export_acp_type!(OperationState);
    export_acp_type!(OperationDegradationCode);
    export_acp_type!(OperationDegradationReason);
    export_acp_type!(OperationSourceLink);
    export_acp_type!(ComputerOperationInputPayload);
    export_acp_type!(ComputerOperationOutputPayload);
    export_acp_type!(ComputerOperationErrorPayload);
    export_acp_type!(ComputerOperationPayload);
    export_acp_type!(ComputerPermissionKind);
    export_acp_type!(ComputerPermissionData);
    export_acp_type!(OperationSnapshot);
    export_acp_type!(InteractionKind);
    export_acp_type!(InteractionState);
    export_acp_type!(PlanApprovalSource);
    export_acp_type!(InteractionPayload);
    export_acp_type!(InteractionResponse);
    export_acp_type!(InteractionSnapshot);
    export_acp_type!(TurnErrorKind);
    export_acp_type!(TurnErrorSource);
    export_acp_type!(TurnFailureSnapshot);
    export_acp_type!(LifecycleStatus);
    export_acp_type!(DetachedReason);
    export_acp_type!(FailureReason);
    export_acp_type!(LifecycleState);
    export_acp_type!(LifecycleCheckpoint);
    export_acp_type!(SessionProjectionSnapshot);
    export_acp_type!(SessionOpenErrorReason);
    export_acp_type!(SessionOpenError);
    export_acp_type!(SessionOpenPath);
    export_acp_type!(SessionOpenTranscriptRowPage);
    export_acp_type!(SessionOpenResultTiming);
    export_acp_type!(SessionOpenFound);
    export_acp_type!(SessionOpenPreparing);
    export_acp_type!(SessionOpenMissing);
    export_acp_type!(SessionOpenResult);
    export_acp_type!(SessionGraphRevision);
    export_acp_type!(SessionRecommendedAction);
    export_acp_type!(SessionRecoveryPhase);
    export_acp_type!(SessionGraphActionability);
    export_acp_type!(SessionGraphLifecycle);
    export_acp_type!(SessionGraphCapabilities);
    export_acp_type!(CapabilityPreviewState);
    export_acp_type!(SessionGraphActivityKind);
    export_acp_type!(SessionGraphActivity);
    export_acp_type!(ActiveStreamingTailContentKind);
    export_acp_type!(ActiveStreamingTail);
    export_acp_type!(TranscriptViewportRowKind);
    export_acp_type!(TranscriptViewportLatestChildAction);
    export_acp_type!(TranscriptViewportOperationDisplayFacts);
    export_acp_type!(TranscriptViewportOperationLink);
    export_acp_type!(TranscriptViewportInteractionLink);
    export_acp_type!(TranscriptViewportRowContent);
    export_acp_type!(TranscriptViewportRow);
    export_acp_type!(SessionStateGraph);
    export_acp_type!(SessionStateSnapshotMaterialization);
    export_acp_type!(SessionStateField);
    export_acp_type!(SessionStateDelta);
    export_acp_type!(AssistantTextDeltaPayload);
    export_acp_type!(ViewportBufferDiagnostic);
    export_acp_type!(ViewportBufferPush);
    export_acp_type!(ViewportBufferDelta);
    export_acp_type!(TranscriptViewportCommandRevision);
    export_acp_type!(SessionStatePayload);
    export_acp_type!(SessionStateEnvelope);

    acp_types = acp_types.replace(
        "export type ModelPresentationMetadata = { displayFamily: ModelDisplayFamily; usageMetrics: UsageMetricsPresentation }",
        "export type ModelPresentationMetadata = { displayFamily: ModelDisplayFamily; usageMetrics: UsageMetricsPresentation; provider?: ProviderMetadataProjection }",
    );
    acp_types = acp_types.replace(
        "export type SessionModelState = { availableModels?: AvailableModel[]; currentModelId?: string; modelsDisplay?: ModelsForDisplay }",
        "export type SessionModelState = { availableModels?: AvailableModel[]; currentModelId?: string; modelsDisplay?: ModelsForDisplay; providerMetadata?: ProviderMetadataProjection }",
    );
    // Specta rc.18 applies `serde(skip_serializing_if)` after `specta(optional)`,
    // so a non-Option predicate incorrectly clears the field's optional flag.
    acp_types = acp_types.replace(
        "export type TranscriptEntry = { entryId: string; scope: TranscriptScope;",
        "export type TranscriptEntry = { entryId: string; scope?: TranscriptScope;",
    );
    // specta does not rename struct variant fields for internally-tagged enums; fix manually
    acp_types = acp_types.replace(
        "{ kind: \"text\"; segment_id: string; text: string }",
        "{ kind: \"text\"; segmentId: string; text: string }",
    );
    acp_types = acp_types.replace(
        "{ kind: \"appendSegment\"; entry_id: string;",
        "{ kind: \"appendSegment\"; entryId: string;",
    );
    if acp_types.contains("StoredEntry") && !acp_types.contains("converted-session-types.js") {
        acp_types = acp_types.replacen(
            "// This file was generated by specta. Do not edit this file manually.\n\n",
            "// This file was generated by specta. Do not edit this file manually.\n\nimport type { StoredEntry } from \"./converted-session-types.js\";\n\n",
            1,
        );
    }

    acp_types.push_str(ACP_TYPES_COMPAT_HELPERS.trim_start());

    let acp_path = Path::new(manifest_dir).join(ACP_TYPES_PATH);
    fs::write(&acp_path, trim_generated_trailing_whitespace(&acp_types))
        .expect("Failed to write acp-types.ts");
    eprintln!("Exported ACP types to {}", acp_path.display());

    // Export checkpoint types
    let checkpoint_types = specta_typescript::export::<FileDiffContent>(&config)
        .expect("Failed to export FileDiffContent");
    let checkpoint_output = format!(
        "// This file was generated by specta. Do not edit this file manually.\n\n{}\n",
        checkpoint_types
    );
    let checkpoint_path = Path::new(manifest_dir).join(CHECKPOINT_TYPES_PATH);
    fs::write(
        &checkpoint_path,
        trim_generated_trailing_whitespace(&checkpoint_output),
    )
    .expect("Failed to write checkpoint-types.ts");
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
        assert!(
            contents.contains("export type CapabilityPreviewState ="),
            "expected acp-types.ts to export CapabilityPreviewState compat helpers, but it did not"
        );
        assert!(
            contents.contains("export type LifecycleCheckpoint ="),
            "expected acp-types.ts to export LifecycleCheckpoint compat helpers, but it did not"
        );
        assert!(
            contents
                .contains("export type FrontendProviderProjection = ProviderMetadataProjection;"),
            "expected acp-types.ts to alias FrontendProviderProjection, but it did not"
        );
        assert!(
            contents.contains("export type AssistantTextDeltaPayload ="),
            "expected acp-types.ts to export AssistantTextDeltaPayload, but it did not"
        );
    }

    #[test]
    fn exports_omitted_root_transcript_scope_as_optional() {
        export_all_types();

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let acp_path = Path::new(manifest_dir).join(ACP_TYPES_PATH);
        let contents =
            fs::read_to_string(&acp_path).expect("Failed to read generated acp-types.ts");

        assert!(
            contents.contains(
                "export type TranscriptEntry = { entryId: string; scope?: TranscriptScope;"
            ),
            "expected omitted root TranscriptEntry.scope to be optional in TypeScript"
        );
    }

    #[test]
    fn converted_session_types_import_acp_session_state_types() {
        export_all_types();

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let session_update_path = Path::new(manifest_dir).join(SESSION_UPDATE_TYPES_PATH);
        let contents = fs::read_to_string(&session_update_path)
            .expect("Failed to read generated session-update-types.ts");

        // Verify both types appear in the acp-types import line (order-independent).
        let acp_import_line = contents
            .lines()
            .find(|line| line.contains("from \"./acp-types.js\""))
            .expect("expected an import from acp-types.js in session-update-types.ts");

        assert!(
            acp_import_line.contains("SessionModelState"),
            "expected SessionModelState in acp-types import, got: {acp_import_line}"
        );
        assert!(
            acp_import_line.contains("SessionModes"),
            "expected SessionModes in acp-types import, got: {acp_import_line}"
        );
    }

    #[test]
    fn converted_session_types_export_stored_error_message() {
        export_all_types();

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let session_update_path = Path::new(manifest_dir).join(SESSION_UPDATE_TYPES_PATH);
        let contents = fs::read_to_string(&session_update_path)
            .expect("Failed to read generated session-update-types.ts");

        assert!(
            contents.contains("export type StoredErrorMessage ="),
            "expected session-update-types.ts to export StoredErrorMessage"
        );
    }

    #[test]
    fn user_settings_types_export_user_setting_key() {
        export_all_types();

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let user_settings_path = Path::new(manifest_dir).join(USER_SETTINGS_TYPES_PATH);
        let contents = fs::read_to_string(&user_settings_path)
            .expect("Failed to read generated user-settings-types.ts");

        assert!(
            contents.contains("export type UserSettingKey ="),
            "expected user-settings-types.ts to export UserSettingKey"
        );
    }
}
