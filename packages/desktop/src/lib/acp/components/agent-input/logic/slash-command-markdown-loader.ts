import type { AgentInputSlashCommandWorkspaceMarkdownResult } from "@acepe/ui/agent-panel";
import { skillsApi } from "$lib/skills/api/skills-api.js";
import type { AgentSkills } from "$lib/skills/types/index.js";
import type { AvailableCommand } from "../../../types/available-command.js";

function findSkillContentForCommand(input: {
	readonly agentSkills: ReadonlyArray<AgentSkills>;
	readonly agentId: string;
	readonly commandName: string;
}): string | null {
	const agentGroup = input.agentSkills.find((group) => group.agentId === input.agentId);
	if (!agentGroup) {
		return null;
	}

	const commandName = input.commandName.trim();
	const skill = agentGroup.skills.find(
		(candidate) => candidate.name === commandName || candidate.folderName === commandName
	);
	return skill ? skill.content : null;
}

export function loadSlashCommandWorkspaceMarkdown(input: {
	readonly command: AvailableCommand;
	readonly tokenType: "command" | "skill";
	readonly agentId: string | null;
}): Promise<AgentInputSlashCommandWorkspaceMarkdownResult> {
	if (input.tokenType !== "skill") {
		return Promise.resolve({
			status: "error",
			message: "Full markdown is only available for skills.",
		});
	}

	if (!input.agentId) {
		return Promise.resolve({
			status: "error",
			message: "No agent is selected for this skill.",
		});
	}
	const agentId = input.agentId;

	return skillsApi
		.listAgentSkills()
		.map((agentSkills) =>
			findSkillContentForCommand({
				agentSkills,
				agentId,
				commandName: input.command.name,
			})
		)
		.match(
			(markdown) => {
				if (markdown && markdown.trim().length > 0) {
					return {
						status: "ready",
						markdown,
					};
				}
				return {
					status: "error",
					message: "Could not find the SKILL.md file for this skill.",
				};
			},
			(error) => ({
				status: "error",
				message: error.message,
			})
		);
}
