import { describe, expect, it } from "bun:test";

import {
	deriveAgentPreferencesInitializationState,
	filterItemsBySelectedAgentIds,
	getAgentEnvOverridesForAgent,
	intersectSelectedAgentIds,
	upsertAgentEnvOverrides,
	upsertCustomAgentConfigs,
	validateAndNormalizeSelectedAgentIds,
} from "../agent-preferences-store.svelte.js";

interface SessionLike {
	readonly id: string;
	readonly agentId: string;
}

describe("deriveAgentPreferencesInitializationState", () => {
	it("migrates existing users with projects to completed onboarding and selects all agents", () => {
		const result = deriveAgentPreferencesInitializationState({
			persistedOnboardingCompleted: null,
			persistedSelectedAgentIds: null,
			projectCount: 2,
			availableAgentIds: ["claude-code", "cursor", "opencode"],
			installedAgentIds: ["claude-code", "cursor"],
		});

		expect(result.onboardingCompleted).toBe(true);
		expect(result.selectedAgentIds).toEqual(["claude-code", "cursor", "opencode"]);
		expect(result.shouldPersistOnboardingCompleted).toBe(true);
		expect(result.shouldPersistSelectedAgentIds).toBe(true);
	});

	it("keeps new users in onboarding and preselects installed agents without persisting selection", () => {
		const result = deriveAgentPreferencesInitializationState({
			persistedOnboardingCompleted: null,
			persistedSelectedAgentIds: null,
			projectCount: 0,
			availableAgentIds: ["claude-code", "cursor", "opencode"],
			installedAgentIds: ["claude-code", "cursor"],
		});

		expect(result.onboardingCompleted).toBe(false);
		expect(result.selectedAgentIds).toEqual(["claude-code", "cursor"]);
		expect(result.shouldPersistOnboardingCompleted).toBe(false);
		expect(result.shouldPersistSelectedAgentIds).toBe(false);
	});

	it("keeps persisted onboarding and selected agents when valid", () => {
		const result = deriveAgentPreferencesInitializationState({
			persistedOnboardingCompleted: true,
			persistedSelectedAgentIds: ["cursor", "claude-code"],
			projectCount: 1,
			availableAgentIds: ["claude-code", "cursor", "opencode"],
			installedAgentIds: ["claude-code", "cursor"],
		});

		expect(result.onboardingCompleted).toBe(true);
		expect(result.selectedAgentIds).toEqual(["cursor", "claude-code"]);
		expect(result.shouldPersistOnboardingCompleted).toBe(false);
		expect(result.shouldPersistSelectedAgentIds).toBe(false);
	});

	it("does not re-enable a disabled agent on reload", () => {
		const result = deriveAgentPreferencesInitializationState({
			persistedOnboardingCompleted: true,
			persistedSelectedAgentIds: ["cursor"],
			projectCount: 2,
			availableAgentIds: ["claude-code", "cursor", "opencode"],
			installedAgentIds: ["claude-code", "cursor", "opencode"],
		});

		expect(result.onboardingCompleted).toBe(true);
		expect(result.selectedAgentIds).toEqual(["cursor"]);
		expect(result.shouldPersistOnboardingCompleted).toBe(false);
		expect(result.shouldPersistSelectedAgentIds).toBe(false);
	});

	it("repairs invalid persisted selected agents for completed onboarding users", () => {
		const result = deriveAgentPreferencesInitializationState({
			persistedOnboardingCompleted: true,
			persistedSelectedAgentIds: ["missing-agent"],
			projectCount: 3,
			availableAgentIds: ["claude-code", "cursor"],
			installedAgentIds: ["claude-code", "cursor"],
		});

		expect(result.onboardingCompleted).toBe(true);
		expect(result.selectedAgentIds).toEqual(["claude-code", "cursor"]);
		expect(result.shouldPersistOnboardingCompleted).toBe(false);
		expect(result.shouldPersistSelectedAgentIds).toBe(true);
	});
});

describe("intersectSelectedAgentIds", () => {
	it("returns all candidate IDs when selected set is empty", () => {
		const result = intersectSelectedAgentIds([], ["claude-code", "cursor"]);
		expect(result).toEqual(["claude-code", "cursor"]);
	});

	it("returns only selected IDs that are present in candidates", () => {
		const result = intersectSelectedAgentIds(["cursor"], ["claude-code", "cursor"]);
		expect(result).toEqual(["cursor"]);
	});

	it("deduplicates while preserving selected order", () => {
		const result = intersectSelectedAgentIds(
			["cursor", "cursor", "claude-code"],
			["claude-code", "cursor"]
		);
		expect(result).toEqual(["cursor", "claude-code"]);
	});
});

describe("filterItemsBySelectedAgentIds", () => {
	const sessions: SessionLike[] = [
		{ id: "s1", agentId: "claude-code" },
		{ id: "s2", agentId: "cursor" },
		{ id: "s3", agentId: "opencode" },
	];

	it("returns all items before preferences are initialized", () => {
		const result = filterItemsBySelectedAgentIds(sessions, ["claude-code"], false);
		expect(result).toEqual(sessions);
	});

	it("returns all items when selected agent list is empty", () => {
		const result = filterItemsBySelectedAgentIds(sessions, [], true);
		expect(result).toEqual(sessions);
	});

	it("hard-filters items to selected agents once initialized", () => {
		const result = filterItemsBySelectedAgentIds(sessions, ["cursor"], true);
		expect(result).toEqual([{ id: "s2", agentId: "cursor" }]);
	});
});

describe("validateAndNormalizeSelectedAgentIds", () => {
	it("deduplicates selected IDs for persistence", () => {
		const result = validateAndNormalizeSelectedAgentIds(["cursor", "cursor", "claude-code"]);
		expect(result).toEqual({ ok: true, value: ["cursor", "claude-code"] });
	});

	it("returns an error when selection is empty", () => {
		const result = validateAndNormalizeSelectedAgentIds([]);
		expect(result).toEqual({
			ok: false,
			error: "At least one agent must remain selected",
		});
	});
});

describe("upsertCustomAgentConfigs", () => {
	it("appends a new config when agent id is new", () => {
		const result = upsertCustomAgentConfigs(
			[
				{
					id: "custom-a",
					name: "Custom A",
					command: "custom-a",
					args: ["--stdio"],
					env: {},
				},
			],
			{
				id: "custom-b",
				name: "Custom B",
				command: "custom-b",
				args: ["--stdio"],
				env: {},
			}
		);

		expect(result).toEqual([
			{
				id: "custom-a",
				name: "Custom A",
				command: "custom-a",
				args: ["--stdio"],
				env: {},
			},
			{
				id: "custom-b",
				name: "Custom B",
				command: "custom-b",
				args: ["--stdio"],
				env: {},
			},
		]);
	});

	it("replaces an existing config when agent id already exists", () => {
		const result = upsertCustomAgentConfigs(
			[
				{
					id: "custom-a",
					name: "Custom A",
					command: "custom-a",
					args: ["--stdio"],
					env: { TEST: "1" },
				},
			],
			{
				id: "custom-a",
				name: "Custom A Updated",
				command: "custom-a",
				args: ["--stdio", "--verbose"],
				env: { TEST: "2" },
			}
		);

		expect(result).toEqual([
			{
				id: "custom-a",
				name: "Custom A Updated",
				command: "custom-a",
				args: ["--stdio", "--verbose"],
				env: { TEST: "2" },
			},
		]);
	});
});

describe("upsertAgentEnvOverrides", () => {
	it("adds env overrides for a new agent", () => {
		const result = upsertAgentEnvOverrides({}, "codex", {
			AZURE_API_KEY: "secret",
		});

		expect(result).toEqual({
			codex: {
				AZURE_API_KEY: "secret",
			},
		});
	});

	it("replaces env overrides for an existing agent", () => {
		const result = upsertAgentEnvOverrides(
			{
				codex: {
					AZURE_API_KEY: "old",
				},
			},
			"codex",
			{
				AZURE_API_KEY: "new",
				AZURE_OPENAI_ENDPOINT: "https://example.azure.com",
			}
		);

		expect(result).toEqual({
			codex: {
				AZURE_API_KEY: "new",
				AZURE_OPENAI_ENDPOINT: "https://example.azure.com",
			},
		});
	});

	it("removes the agent entry when overrides are empty", () => {
		const result = upsertAgentEnvOverrides(
			{
				codex: {
					AZURE_API_KEY: "secret",
				},
				"claude-code": {
					HTTPS_PROXY: "http://localhost:8080",
				},
			},
			"codex",
			{}
		);

		expect(result).toEqual({
			"claude-code": {
				HTTPS_PROXY: "http://localhost:8080",
			},
		});
	});
});

describe("getAgentEnvOverridesForAgent", () => {
	it("returns the saved overrides for the requested agent", () => {
		const result = getAgentEnvOverridesForAgent(
			{
				codex: {
					AZURE_API_KEY: "secret",
				},
			},
			"codex"
		);

		expect(result).toEqual({
			AZURE_API_KEY: "secret",
		});
	});

	it("returns an empty object when no overrides are saved", () => {
		const result = getAgentEnvOverridesForAgent({}, "codex");

		expect(result).toEqual({});
	});
});
