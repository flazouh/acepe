import { describe, expect, it } from "bun:test";

import type { ProviderMetadataProjection } from "$lib/services/acp-types.js";
import { buildNewChatAgentSelectorModel } from "./new-chat-agent-selector-model.js";

const PROVIDER_METADATA: ProviderMetadataProjection = {
	providerBrand: "claude-code",
	displayName: "Claude Code",
	displayOrder: 10,
	supportsModelDefaults: true,
	variantGroup: "plain",
	defaultAlias: "default",
	reasoningEffortSupport: false,
	preconnectionSlashMode: "startupGlobal",
	preconnectionCapabilityMode: "startupGlobal",
	implicitSessionCreationMode: "allowed",
};

describe("buildNewChatAgentSelectorModel", () => {
	it("keeps canonical provider metadata and selected project path for an unavailable agent", () => {
		const model = buildNewChatAgentSelectorModel({
			agents: [
				{
					id: "claude-code",
					name: "Claude Code",
					icon: "claude-code",
					availability_kind: { kind: "installable", installed: false },
					providerMetadata: PROVIDER_METADATA,
				},
			],
			selectedAgentIds: ["claude-code"],
			selectedProjectPath: "/projects/acepe",
		});

		expect(model.projectPath).toBe("/projects/acepe");
		expect(model.availableAgents).toEqual([
			{
				id: "claude-code",
				name: "Claude Code",
				icon: "claude-code",
				availability_kind: { kind: "installable", installed: false },
				default_selection_rank: undefined,
				provider_metadata: PROVIDER_METADATA,
				supports_project_discovery: false,
			},
		]);
	});
});
