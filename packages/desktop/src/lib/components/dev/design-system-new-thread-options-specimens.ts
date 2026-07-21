import type { AgentInputConfigOption } from "@acepe/ui/agent-panel";
import { TAG_COLORS } from "@acepe/ui/colors";
import type { Model } from "$lib/acp/application/dto/model.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { ProviderMetadataProjection } from "$lib/services/acp-types.js";

export const newThreadOptionsSectionMeta = {
	title: "New thread options",
	description:
		"Floating setup chips above the composer before a session exists: project, agent, branch, and worktree controls; model and reasoning stay in the composer toolbar.",
};

export const mockProjects: readonly Project[] = [
	{
		path: "/demo/acepe",
		name: "acepe",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		color: TAG_COLORS[2],
	},
];

export const mockCodexProviderMetadata: ProviderMetadataProjection = {
	providerBrand: "codex",
	displayName: "Codex",
	displayOrder: 50,
	supportsModelDefaults: true,
	variantGroup: "reasoningEffort",
	reasoningEffortSupport: true,
	preconnectionSlashMode: "startupGlobal",
	preconnectionCapabilityMode: "startupGlobal",
	implicitSessionCreationMode: "allowed",
};

export const mockAgents: readonly {
	readonly id: string;
	readonly name: string;
	readonly provider_metadata?: ProviderMetadataProjection;
}[] = [
	{
		id: "codex",
		name: "Codex Agent",
		provider_metadata: mockCodexProviderMetadata,
	},
	{
		id: "claude-code",
		name: "Claude Code",
		provider_metadata: {
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
		},
	},
];

export const mockModels: readonly Model[] = [
	{ id: "gpt-5.5", name: "Gpt-5.5" },
	{ id: "gpt-5.4", name: "Gpt-5.4" },
];

const REASONING_OPTION_CHOICES: readonly { name: string; value: string }[] = [
	{ name: "Minimal", value: "minimal" },
	{ name: "Low", value: "low" },
	{ name: "Medium", value: "medium" },
	{ name: "High", value: "high" },
	{ name: "Extra high", value: "xhigh" },
];

export function buildReasoningConfigOption(currentValue: string): AgentInputConfigOption {
	return {
		id: "reasoning_effort",
		name: "Reasoning Effort",
		category: "reasoning_effort",
		type: "select",
		description: "Controls Codex reasoning depth.",
		currentValue,
		presentation: "compactReasoning",
		options: REASONING_OPTION_CHOICES,
	};
}

export interface ReasoningLevelSpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly currentValue: string;
}

export const reasoningLevelSpecimens: readonly ReasoningLevelSpecimen[] = [
	{
		id: "minimal",
		label: "Minimal",
		caption: "1 segment · green",
		currentValue: "minimal",
	},
	{
		id: "low",
		label: "Low",
		caption: "2 segments · green blend",
		currentValue: "low",
	},
	{
		id: "medium",
		label: "Medium",
		caption: "3 segments · orange blend",
		currentValue: "medium",
	},
	{
		id: "high",
		label: "High",
		caption: "4 segments · orange",
		currentValue: "high",
	},
	{
		id: "xhigh",
		label: "Extra high",
		caption: "5 segments · red",
		currentValue: "xhigh",
	},
];

export const featuredNewThreadOptionsSpecimen = {
	project: mockProjects[0],
	agentId: "codex",
	modelId: "gpt-5.5",
	reasoningValue: "medium",
	worktreeOn: true,
};
