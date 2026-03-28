import { beforeEach, describe, expect, it, vi } from "vitest";
import { errAsync, okAsync } from "neverthrow";
import { AgentError } from "../../acp/errors/app-error";
import { skillsApi } from "../api/skills-api.js";
import {
	normalizeAgentSkillsToCommands,
	PreconnectionAgentSkillsStore,
} from "./preconnection-agent-skills-store.svelte.js";

vi.mock("../api/skills-api.js", () => ({
	skillsApi: {
		listAgentSkills: vi.fn(),
	},
}));

describe("PreconnectionAgentSkillsStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("normalizes skills by agent using frontmatter name and description", async () => {
		vi.mocked(skillsApi.listAgentSkills).mockReturnValue(
			okAsync([
				{
					agentId: "claude-code",
					skills: [
						{
							id: "claude-code::ce-brainstorm",
							agentId: "claude-code",
							folderName: "ce-brainstorm",
							path: "/tmp/ce-brainstorm/SKILL.md",
							name: "ce:brainstorm",
							description: "Brainstorm a feature",
							content: "",
							modifiedAt: 1,
						},
					],
				},
				{
					agentId: "cursor",
					skills: [],
				},
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
			{
				id: "claude-code::ce-brainstorm",
				agentId: "claude-code",
				folderName: "ce-brainstorm",
				path: "/tmp/one/SKILL.md",
				name: "ce:brainstorm",
				description: "First description",
				content: "",
				modifiedAt: 1,
			},
			{
				id: "claude-code::brainstorm-duplicate",
				agentId: "claude-code",
				folderName: "brainstorm-duplicate",
				path: "/tmp/two/SKILL.md",
				name: "ce:brainstorm",
				description: "Second description",
				content: "",
				modifiedAt: 2,
			},
		]);

		expect(commands).toEqual([
			{
				name: "ce:brainstorm",
				description: "First description",
			},
		]);
	});

	it("keeps the store retryable when initialization fails", async () => {
		vi.mocked(skillsApi.listAgentSkills).mockReturnValue(
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
		const mockedListAgentSkills = vi.mocked(skillsApi.listAgentSkills);
		mockedListAgentSkills
			.mockReturnValueOnce(errAsync(new AgentError("skills_list_agent_skills", new Error("boom"))))
			.mockReturnValueOnce(
				okAsync([
					{
						agentId: "claude-code",
						skills: [
							{
								id: "claude-code::ce-plan",
								agentId: "claude-code",
								folderName: "ce-plan",
								path: "/tmp/ce-plan/SKILL.md",
								name: "ce:plan",
								description: "Plan implementation",
								content: "",
								modifiedAt: 1,
							},
						],
					},
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
});
