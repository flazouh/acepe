import { mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "../../acp/errors/app-error";
import type { AgentSkills, Skill } from "../types/index.js";

const listAgentSkillsMock = vi.fn();

let PreconnectionAgentSkillsStore: typeof import("./preconnection-agent-skills-store.svelte.js").PreconnectionAgentSkillsStore;
let normalizeAgentSkillsToCommands: typeof import("./preconnection-agent-skills-store.svelte.js").normalizeAgentSkillsToCommands;

function buildSkill(options: {
	id: string;
	agentId: string;
	folderName: string;
	name: string;
	description: string;
}): Skill {
	return {
		id: options.id,
		agentId: options.agentId,
		folderName: options.folderName,
		path: `/tmp/${options.agentId}/${options.folderName}/SKILL.md`,
		name: options.name,
		description: options.description,
		content: "",
		modifiedAt: 1,
	};
}

function buildAgentSkills(agentId: string, skills: Skill[]): AgentSkills {
	return {
		agentId,
		skills,
	};
}

describe("PreconnectionAgentSkillsStore", () => {
	beforeEach(async () => {
		listAgentSkillsMock.mockReset();

		mock.module("../api/skills-api.js", () => ({
			skillsApi: {
				listAgentSkills: listAgentSkillsMock,
			},
		}));

		({ PreconnectionAgentSkillsStore, normalizeAgentSkillsToCommands } = await import(
			"./preconnection-agent-skills-store.svelte.js"
		));
	});

	it("normalizes on-disk skills by agent using frontmatter name and description", async () => {
		listAgentSkillsMock.mockReturnValue(
			okAsync([
				buildAgentSkills("claude-code", [
					buildSkill({
						id: "skill-1",
						agentId: "claude-code",
						folderName: "brainstorm-feature",
						name: "ce:brainstorm",
						description: "Brainstorm a feature",
					}),
				]),
				buildAgentSkills("cursor", []),
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
		const commands = normalizeAgentSkillsToCommands(
			buildAgentSkills("claude-code", [
				buildSkill({
					id: "skill-1",
					agentId: "claude-code",
					folderName: "brainstorm-first",
					name: "ce:brainstorm",
					description: "First description",
				}),
				buildSkill({
					id: "skill-2",
					agentId: "claude-code",
					folderName: "brainstorm-second",
					name: "ce:brainstorm",
					description: "Second description",
				}),
			])
		);

		expect(commands).toEqual([
			{
				name: "ce:brainstorm",
				description: "First description",
			},
		]);
	});

	it("keeps the store retryable when initialization fails", async () => {
		listAgentSkillsMock.mockReturnValue(
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
		listAgentSkillsMock
			.mockReturnValueOnce(errAsync(new AgentError("skills_list_agent_skills", new Error("boom"))))
			.mockReturnValueOnce(
				okAsync([
					buildAgentSkills("claude-code", [
						buildSkill({
							id: "skill-1",
							agentId: "claude-code",
							folderName: "plan-implementation",
							name: "ce:plan",
							description: "Plan implementation",
						}),
					]),
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
		listAgentSkillsMock
			.mockReturnValueOnce(errAsync(new AgentError("skills_list_agent_skills", new Error("boom"))))
			.mockReturnValueOnce(
				okAsync([
					buildAgentSkills("claude-code", [
						buildSkill({
							id: "skill-1",
							agentId: "claude-code",
							folderName: "review-changes",
							name: "ce:review",
							description: "Review changes",
						}),
					]),
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
