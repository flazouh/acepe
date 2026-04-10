import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	BUILTIN_PROVIDER_METADATA_BY_AGENT_ID,
	normalizeModelsForDisplay,
	resolveProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";

const rustSource = readFileSync(
	resolve(__dirname, "../../../../src-tauri/src/acp/parsers/provider_capabilities.rs"),
	"utf8"
);

describe("provider metadata projection contract", () => {
	it("keeps the TypeScript built-in projection metadata aligned with Rust provider capabilities", () => {
		for (const [agentId, metadata] of Object.entries(BUILTIN_PROVIDER_METADATA_BY_AGENT_ID)) {
			expect(rustSource).toMatch(
				new RegExp(
					`provider_id:\\s*"${agentId}"[\\s\\S]*?frontend_projection:\\s*FrontendProviderProjection\\s*\\{[\\s\\S]*?provider_brand:\\s*"${metadata.providerBrand}"[\\s\\S]*?display_name:\\s*"${metadata.displayName}"[\\s\\S]*?display_order:\\s*${metadata.displayOrder}[\\s\\S]*?supports_model_defaults:\\s*${metadata.supportsModelDefaults}[\\s\\S]*?variant_group:\\s*FrontendVariantGroup::${metadata.variantGroup === "reasoningEffort" ? "ReasoningEffort" : "Plain"}[\\s\\S]*?default_alias:\\s*${metadata.defaultAlias ? `Some\\("${metadata.defaultAlias}"\\)` : "None"}[\\s\\S]*?reasoning_effort_support:\\s*${metadata.reasoningEffortSupport}[\\s\\S]*?autonomous_apply_strategy:\\s*AutonomousApplyStrategy::${metadata.autonomousApplyStrategy === "launchProfile" ? "LaunchProfile" : "PostConnect"}[\\s\\S]*?preconnection_slash_mode:\\s*PreconnectionSlashMode::${metadata.preconnectionSlashMode === "startupGlobal" ? "StartupGlobal" : metadata.preconnectionSlashMode === "projectScoped" ? "ProjectScoped" : "Unsupported"}`,
					"m"
				)
			);
		}
	});

	it("falls back to a neutral custom projection when the backend omits metadata", () => {
		expect(resolveProviderMetadataProjection("custom-agent", undefined)).toEqual({
			providerBrand: "custom",
			displayName: "custom-agent",
			displayOrder: 65535,
			supportsModelDefaults: false,
			variantGroup: "plain",
			defaultAlias: undefined,
			reasoningEffortSupport: false,
			autonomousApplyStrategy: "postConnect",
			preconnectionSlashMode: "unsupported",
		});
	});

	it("normalizes codex metadata into reasoning-effort display family when backend presentation is sparse", () => {
		expect(
			normalizeModelsForDisplay(
				"codex",
				{
					groups: [],
					presentation: {
						usageMetrics: "spendAndContext",
					},
				} as unknown as Parameters<typeof normalizeModelsForDisplay>[1]
			)
		).toEqual({
			groups: [],
			presentation: {
				displayFamily: "codexReasoningEffort",
				usageMetrics: "spendAndContext",
				provider: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.codex,
			},
		});
	});
});
