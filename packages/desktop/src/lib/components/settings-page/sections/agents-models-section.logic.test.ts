import { describe, expect, it } from "bun:test";
import type { Agent } from "$lib/acp/store/types.js";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "$lib/services/acp-provider-metadata.js";

import {
	applyAgentSelectionChange,
	getAgentModelDefaultsEntries,
	getAgentsByProviderOrder,
	getProviderDefaultLabel,
} from "./agents-models-section.logic.js";

describe("applyAgentSelectionChange", () => {
	it("returns unchanged state when callback repeats the current checked state", () => {
		const currentlySelected = ["claude-code", "cursor"];

		const result = applyAgentSelectionChange(currentlySelected, "claude-code", true);

		expect(result).toEqual({
			ok: true,
			changed: false,
			value: ["claude-code", "cursor"],
		});
	});

	it("removes an agent when checked changes from true to false", () => {
		const result = applyAgentSelectionChange(["claude-code", "cursor"], "cursor", false);

		expect(result).toEqual({
			ok: true,
			changed: true,
			value: ["claude-code"],
		});
	});

	it("adds an agent when checked changes from false to true", () => {
		const result = applyAgentSelectionChange(["claude-code"], "cursor", true);

		expect(result).toEqual({
			ok: true,
			changed: true,
			value: ["claude-code", "cursor"],
		});
	});

	it("blocks unchecking the final selected agent", () => {
		const result = applyAgentSelectionChange(["claude-code"], "claude-code", false);

		expect(result).toEqual({
			ok: false,
			error: "At least one agent must remain selected",
		});
	});
});

describe("getAgentModelDefaultsEntries", () => {
	const claudeProviderMetadata: ProviderMetadataProjection = {
		providerBrand: "claude-code",
		displayName: "Claude Code",
		displayOrder: 10,
		supportsModelDefaults: true,
		variantGroup: "plain",
		defaultAlias: "default",
		reasoningEffortSupport: false,
		autonomousApplyStrategy: "launchProfile",
		preconnectionSlashMode: "startupGlobal",
	};

	const cursorProviderMetadata: ProviderMetadataProjection = {
		providerBrand: "cursor",
		displayName: "Cursor",
		displayOrder: 20,
		supportsModelDefaults: true,
		variantGroup: "plain",
		defaultAlias: "auto",
		reasoningEffortSupport: false,
		autonomousApplyStrategy: "postConnect",
		preconnectionSlashMode: "startupGlobal",
	};

	const copilotProviderMetadata: ProviderMetadataProjection = {
		providerBrand: "copilot",
		displayName: "GitHub Copilot",
		displayOrder: 30,
		supportsModelDefaults: false,
		variantGroup: "plain",
		defaultAlias: undefined,
		reasoningEffortSupport: false,
		autonomousApplyStrategy: "postConnect",
		preconnectionSlashMode: "projectScoped",
	};

	const agents: Agent[] = [
		{
			id: "copilot",
			name: "GitHub Copilot",
			description: "",
			icon: "copilot",
			availability_kind: { kind: "installable", installed: true },
			autonomous_supported_mode_ids: [],
			default_selection_rank: 30,
			providerMetadata: copilotProviderMetadata,
		},
		{
			id: "cursor",
			name: "Cursor",
			description: "",
			icon: "cursor",
			availability_kind: { kind: "installable", installed: true },
			autonomous_supported_mode_ids: [],
			default_selection_rank: 20,
			providerMetadata: cursorProviderMetadata,
		},
		{
			id: "claude-code",
			name: "Claude Code",
			description: "",
			icon: "claude-code",
			availability_kind: { kind: "installable", installed: true },
			autonomous_supported_mode_ids: [],
			default_selection_rank: 10,
			providerMetadata: claudeProviderMetadata,
		},
	];

	it("filters to providers that support model defaults and sorts by display order", () => {
		const entries = getAgentModelDefaultsEntries(agents, () => null);

		expect(entries.map((entry) => entry.agent.id)).toEqual(["claude-code", "cursor"]);
	});

	it("prefers cached modelsDisplay provider metadata when ordering providers", () => {
		const cachedModelsDisplay: ModelsForDisplay = {
			groups: [],
			presentation: {
				displayFamily: "providerGrouped",
				usageMetrics: "spendAndContext",
				provider: {
					providerBrand: "cursor",
					displayName: "Cursor",
					displayOrder: 5,
					supportsModelDefaults: true,
					variantGroup: "plain",
					defaultAlias: "auto",
					reasoningEffortSupport: false,
					autonomousApplyStrategy: "postConnect",
					preconnectionSlashMode: "startupGlobal",
				},
			},
		};

		const entries = getAgentModelDefaultsEntries(agents, (agentId) =>
			agentId === "cursor" ? cachedModelsDisplay : null
		);

		expect(entries.map((entry) => entry.agent.id)).toEqual(["cursor", "claude-code"]);
	});
});

describe("getAgentsByProviderOrder", () => {
	it("sorts agents by projected provider display order with stable fallbacks", () => {
		const entries = getAgentsByProviderOrder(
			[
				{
					id: "custom",
					name: "Zeta Custom",
					description: "",
					icon: "custom",
					availability_kind: { kind: "installable", installed: true },
					autonomous_supported_mode_ids: [],
					default_selection_rank: 99,
				},
				{
					id: "cursor",
					name: "Cursor",
					description: "",
					icon: "cursor",
					availability_kind: { kind: "installable", installed: true },
					autonomous_supported_mode_ids: [],
					default_selection_rank: 20,
					providerMetadata: {
						providerBrand: "cursor",
						displayName: "Cursor",
						displayOrder: 20,
						supportsModelDefaults: true,
						variantGroup: "plain",
						defaultAlias: "auto",
						reasoningEffortSupport: false,
						autonomousApplyStrategy: "postConnect",
						preconnectionSlashMode: "startupGlobal",
					},
				},
				{
					id: "claude-code",
					name: "Claude Code",
					description: "",
					icon: "claude-code",
					availability_kind: { kind: "installable", installed: true },
					autonomous_supported_mode_ids: [],
					default_selection_rank: 10,
					providerMetadata: {
						providerBrand: "claude-code",
						displayName: "Claude Code",
						displayOrder: 10,
						supportsModelDefaults: true,
						variantGroup: "plain",
						defaultAlias: "default",
						reasoningEffortSupport: false,
						autonomousApplyStrategy: "launchProfile",
						preconnectionSlashMode: "startupGlobal",
					},
				},
			],
			() => null
		);

		expect(entries.map((entry) => entry.id)).toEqual(["claude-code", "cursor", "custom"]);
	});
});

describe("getProviderDefaultLabel", () => {
	it("uses the provider alias when available", () => {
		expect(
			getProviderDefaultLabel({
				providerBrand: "cursor",
				displayName: "Cursor",
				displayOrder: 20,
				supportsModelDefaults: true,
				variantGroup: "plain",
				defaultAlias: "auto",
				reasoningEffortSupport: false,
				autonomousApplyStrategy: "postConnect",
				preconnectionSlashMode: "startupGlobal",
			})
		).toBe("Auto");
	});

	it("falls back to the shared agent-default label when no alias exists", () => {
		expect(
			getProviderDefaultLabel({
				providerBrand: "opencode",
				displayName: "OpenCode",
				displayOrder: 40,
				supportsModelDefaults: true,
				variantGroup: "plain",
				defaultAlias: undefined,
				reasoningEffortSupport: false,
				autonomousApplyStrategy: "postConnect",
				preconnectionSlashMode: "projectScoped",
			})
		).toBe("Agent default");
	});
});
