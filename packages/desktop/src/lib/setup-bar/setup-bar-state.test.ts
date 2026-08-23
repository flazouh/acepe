import { emptyRpcSessionSnapshot, emptySkillsCatalog, ProjectId } from "@acepe/contracts";
import { describe, expect, it } from "bun:test";

import {
	mapConfigOptionToAgentInput,
	mapMcpServersToSetupBarRows,
	mapPreconnectionOptionsToAgentInput,
	mapSkillsToSetupBarRows,
	mergeSetupBarSnapshots,
} from "./setup-bar-state.ts";

describe("setup bar mapping", () => {
	it("maps skills, mcp servers, and reasoning options from snapshots", () => {
		const skillsSnap = emptyRpcSessionSnapshot(2);
		const withSkills = {
			snapshotSequence: skillsSnap.snapshotSequence,
			session: skillsSnap.session,
			messages: skillsSnap.messages,
			turns: skillsSnap.turns,
			activities: skillsSnap.activities,
			pendingApprovals: skillsSnap.pendingApprovals,
			checkpoints: skillsSnap.checkpoints,
			projects: skillsSnap.projects,
			sessions: skillsSnap.sessions,
			settings: skillsSnap.settings,
			skillsCatalog: {
				sequence: 2,
				agents: emptySkillsCatalog.agents,
				agentSkills: [
					{
						agentId: "claude-code" as const,
						skills: [
							{
								id: "claude-code::issue-244-review",
								agentId: "claude-code" as const,
								folderName: "issue-244-review",
								path: "/tmp/skill/SKILL.md",
								name: "issue-244-review",
								description: "Review diffs",
								content: "# issue-244-review",
								modifiedAt: 0,
							},
						],
					},
				],
				plugins: emptySkillsCatalog.plugins,
				pluginSkills: emptySkillsCatalog.pluginSkills,
				tree: emptySkillsCatalog.tree,
			},
			voice: skillsSnap.voice,
			gitReview: skillsSnap.gitReview,
			mcpCatalog: skillsSnap.mcpCatalog,
			preconnectionOptions: skillsSnap.preconnectionOptions,
		};
		const mcpSnap = emptyRpcSessionSnapshot(3);
		const withMcp = {
			snapshotSequence: 3,
			session: mcpSnap.session,
			messages: mcpSnap.messages,
			turns: mcpSnap.turns,
			activities: mcpSnap.activities,
			pendingApprovals: mcpSnap.pendingApprovals,
			checkpoints: mcpSnap.checkpoints,
			projects: mcpSnap.projects,
			sessions: mcpSnap.sessions,
			settings: mcpSnap.settings,
			skillsCatalog: mcpSnap.skillsCatalog,
			voice: mcpSnap.voice,
			gitReview: mcpSnap.gitReview,
			mcpCatalog: {
				sequence: 3,
				projectId: ProjectId.make("library-project-1"),
				catalog: {
					source: "preconnectionConfig" as const,
					servers: [
						{
							id: "github",
							name: "github",
							status: "unknown" as const,
							error: null,
							tools: [],
							slashCommands: [],
						},
					],
				},
			},
			preconnectionOptions: {
				sequence: 3,
				projectId: ProjectId.make("library-project-1"),
				providerId: "claude-code",
				options: [
					{
						id: "reasoning_effort",
						name: "Reasoning Effort",
						category: "reasoning_effort",
						type: "select",
						currentValue: "auto",
						presentation: "compactReasoning" as const,
					},
				],
			},
		};
		const merged = mergeSetupBarSnapshots(withSkills, withMcp);
		expect(mapSkillsToSetupBarRows(merged.skillsCatalog).map((row) => row.name)).toEqual([
			"issue-244-review",
		]);
		expect(mapMcpServersToSetupBarRows(merged).map((row) => row.id)).toEqual(["github"]);
		expect(mapPreconnectionOptionsToAgentInput(merged).map((row) => row.id)).toEqual([
			"reasoning_effort",
		]);
	});

	it("drops hidden config options", () => {
		const mapped = mapConfigOptionToAgentInput({
			id: "hidden",
			name: "Hidden",
			category: "hidden",
			type: "string",
			presentation: "hidden",
		});
		expect(mapped).toBeNull();
	});
});
