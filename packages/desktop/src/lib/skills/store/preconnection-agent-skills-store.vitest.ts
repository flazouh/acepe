import { beforeEach, describe, expect, it, vi } from "vitest";
import { errAsync, okAsync } from "neverthrow";
import { AgentError } from "../../acp/errors/app-error";
import { libraryApi } from "../api/skills-api.js";
import type { LibrarySkillWithSync } from "../types/index.js";
import {
	normalizeAgentSkillsToCommands,
	PreconnectionAgentSkillsStore,
} from "./preconnection-agent-skills-store.svelte.js";

vi.mock("../api/skills-api.js", () => ({
	libraryApi: {
		listSkillsWithSync: vi.fn(),
	},
}));

function buildLibrarySkillWithSync(options: {
	id: string;
	name: string;
	description: string | null;
	targets: Array<{ agentId: string; enabled: boolean }>;
}): LibrarySkillWithSync {
	return {
		skill: {
			id: options.id,
			name: options.name,
			description: options.description,
			content: "",
			category: null,
			createdAt: 1,
			updatedAt: 1,
		},
		syncTargets: options.targets.map((target) => ({
			agentId: target.agentId,
			agentName: target.agentId,
			enabled: target.enabled,
			status: target.enabled ? "synced" : "never",
			syncedAt: target.enabled ? 1 : null,
		})),
		hasPendingChanges: false,
	};
}

describe("PreconnectionAgentSkillsStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("normalizes skills by agent using frontmatter name and description", async () => {
		vi.mocked(libraryApi.listSkillsWithSync).mockReturnValue(
			okAsync([
				buildLibrarySkillWithSync({
					id: "skill-1",
					name: "ce:brainstorm",
					description: "Brainstorm a feature",
					targets: [{ agentId: "claude-code", enabled: true }],
				}),
			])
		);

		const store = new PreconnectionAgentSkillsStore();
		const result = await store.initialize();

		expect(result.isOk()).toBe(true);
		expect(store.loaded).toBe(true);
		expect(store.getCommandsForAgent("claude-code")).toEqual([
			{
				name: "ce:brainstorm",
				description: "Brainstorm a feature",
			},
		]);
		expect(store.getCommandsForAgent("cursor")).toEqual([]);
	});

	it("drops later duplicate names within one agent deterministically", () => {
		const commands = normalizeAgentSkillsToCommands([
			buildLibrarySkillWithSync({
				id: "skill-1",
				name: "ce:brainstorm",
				description: "First description",
				targets: [{ agentId: "claude-code", enabled: true }],
			}),
			buildLibrarySkillWithSync({
				id: "skill-2",
				name: "ce:brainstorm",
				description: "Second description",
				targets: [{ agentId: "claude-code", enabled: true }],
			}),
		], "claude-code");

		expect(commands).toEqual([
			{
				name: "ce:brainstorm",
				description: "First description",
			},
		]);
	});

	it("keeps the store retryable when initialization fails", async () => {
		vi.mocked(libraryApi.listSkillsWithSync).mockReturnValue(
			errAsync(new AgentError("skills_list_agent_skills", new Error("boom")))
		);

		const store = new PreconnectionAgentSkillsStore();
		const result = await store.initialize();

		expect(result.isErr()).toBe(true);
		expect(store.loaded).toBe(false);
		expect(store.error).toBe("Agent operation failed: skills_list_agent_skills");
		expect(store.getCommandsForAgent("claude-code")).toEqual([]);
	});

	it("can retry successfully after an initialization failure", async () => {
		const mockedListSkillsWithSync = vi.mocked(libraryApi.listSkillsWithSync);
		mockedListSkillsWithSync
			.mockReturnValueOnce(errAsync(new AgentError("skills_list_agent_skills", new Error("boom"))))
			.mockReturnValueOnce(
				okAsync([
					buildLibrarySkillWithSync({
						id: "skill-1",
						name: "ce:plan",
						description: "Plan implementation",
						targets: [{ agentId: "claude-code", enabled: true }],
					}),
				])
			);

		const store = new PreconnectionAgentSkillsStore();
		const firstResult = await store.initialize();
		const secondResult = await store.initialize();

		expect(firstResult.isErr()).toBe(true);
		expect(secondResult.isOk()).toBe(true);
		expect(store.getCommandsForAgent("claude-code")).toEqual([
			{
				name: "ce:plan",
				description: "Plan implementation",
			},
		]);
	});

	it("ensureLoaded retries after a failed startup warmup", async () => {
		const mockedListSkillsWithSync = vi.mocked(libraryApi.listSkillsWithSync);
		mockedListSkillsWithSync
			.mockReturnValueOnce(errAsync(new AgentError("skills_list_agent_skills", new Error("boom"))))
			.mockReturnValueOnce(
				okAsync([
					buildLibrarySkillWithSync({
						id: "skill-1",
						name: "ce:review",
						description: "Review changes",
						targets: [{ agentId: "claude-code", enabled: true }],
					}),
				])
			);

		const store = new PreconnectionAgentSkillsStore();
		const firstResult = await store.initialize();
		const secondResult = await store.ensureLoaded();

		expect(firstResult.isErr()).toBe(true);
		expect(secondResult.isOk()).toBe(true);
		expect(store.getCommandsForAgent("claude-code")).toEqual([
			{
				name: "ce:review",
				description: "Review changes",
			},
		]);
	});
});
