import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "../../acp/errors/app-error";
import type { ProviderMetadataProjection } from "../../services/acp-types.js";

let PreconnectionAgentSkillsStore: typeof import("./preconnection-agent-skills-store.svelte.js").PreconnectionAgentSkillsStore;
let normalizePreconnectionCommands: typeof import("./preconnection-agent-skills-store.svelte.js").normalizePreconnectionCommands;

function providerMetadata(
	preconnectionSlashMode: ProviderMetadataProjection["preconnectionSlashMode"]
): ProviderMetadataProjection {
	return {
		providerBrand: "custom",
		displayName: "Test",
		displayOrder: 1,
		supportsModelDefaults: false,
		variantGroup: "plain",
		defaultAlias: undefined,
		reasoningEffortSupport: false,
		preconnectionSlashMode,
		preconnectionCapabilityMode: preconnectionSlashMode,
	};
}

function buildAgent(
	id: string,
	preconnectionSlashMode: ProviderMetadataProjection["preconnectionSlashMode"]
): {
	readonly id: string;
	readonly providerMetadata: ProviderMetadataProjection;
} {
	return {
		id,
		providerMetadata: providerMetadata(preconnectionSlashMode),
	};
}

describe("PreconnectionAgentSkillsStore", () => {
	beforeEach(async () => {
		({ PreconnectionAgentSkillsStore, normalizePreconnectionCommands } = await import(
			"./preconnection-agent-skills-store.svelte.js"
		));
	});

	it("warms startup-global providers through the shared ACP preconnection command", async () => {
		const fetchPreconnectionCommands = vi
			.fn()
			.mockReturnValueOnce(okAsync([{ name: "ce:brainstorm", description: "Brainstorm" }]));

		const store = new PreconnectionAgentSkillsStore(fetchPreconnectionCommands);
		const result = await store.initialize([
			buildAgent("claude-code", "startupGlobal"),
			buildAgent("copilot", "projectScoped"),
		]);

		expect(result.isOk()).toBe(true);
		expect(fetchPreconnectionCommands).toHaveBeenCalledTimes(1);
		expect(fetchPreconnectionCommands).toHaveBeenCalledWith("", "claude-code");
		expect(store.getCommandsForAgent("claude-code")).toEqual([
			{
				name: "ce:brainstorm",
				description: "Brainstorm",
				input: undefined,
			},
		]);
		expect(store.getCommandsForAgent("copilot")).toEqual([]);
	});

	it("drops later duplicate command names deterministically", () => {
		const commands = normalizePreconnectionCommands(
			[
				{ name: "ce:plan", description: "First description" },
				{ name: "ce:plan", description: "Second description" },
			],
			"claude-code"
		);

		expect(commands).toEqual([
			{
				name: "ce:plan",
				description: "First description",
				input: undefined,
			},
		]);
	});

	it("keeps the store retryable when warmup fails", async () => {
		const fetchPreconnectionCommands = vi
			.fn()
			.mockReturnValue(
				errAsync(new AgentError("acp_list_preconnection_commands", new Error("boom")))
			);

		const store = new PreconnectionAgentSkillsStore(fetchPreconnectionCommands);
		const result = await store.initialize([buildAgent("claude-code", "startupGlobal")]);

		expect(result.isErr()).toBe(true);
		expect(store.loaded).toBe(false);
		expect(store.error).toBe("Agent operation failed: acp_list_preconnection_commands");
		expect(store.getCommandsForAgent("claude-code")).toEqual([]);
	});

	it("can retry successfully after an initialization failure", async () => {
		const fetchPreconnectionCommands = vi
			.fn()
			.mockReturnValueOnce(
				errAsync(new AgentError("acp_list_preconnection_commands", new Error("boom")))
			)
			.mockReturnValueOnce(okAsync([{ name: "ce:review", description: "Review changes" }]));

		const store = new PreconnectionAgentSkillsStore(fetchPreconnectionCommands);
		const firstResult = await store.initialize([buildAgent("claude-code", "startupGlobal")]);
		const secondResult = await store.initialize([buildAgent("claude-code", "startupGlobal")]);

		expect(firstResult.isErr()).toBe(true);
		expect(secondResult.isOk()).toBe(true);
		expect(store.getCommandsForAgent("claude-code")).toEqual([
			{
				name: "ce:review",
				description: "Review changes",
				input: undefined,
			},
		]);
	});

	it("marks warmup complete when no startup-global providers exist", async () => {
		const fetchPreconnectionCommands = vi.fn();
		const store = new PreconnectionAgentSkillsStore(fetchPreconnectionCommands);
		const result = await store.initialize([buildAgent("copilot", "projectScoped")]);

		expect(result.isOk()).toBe(true);
		expect(store.loaded).toBe(true);
		expect(fetchPreconnectionCommands).not.toHaveBeenCalled();
	});
});
