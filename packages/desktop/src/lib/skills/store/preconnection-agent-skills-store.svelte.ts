import { okAsync, type ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { AvailableCommand } from "$lib/acp/types/available-command.js";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { skillsApi } from "../api/skills-api.js";
import type { AgentSkillsGroup, Skill } from "../types/index.js";

const PRECONNECTION_AGENT_SKILLS_STORE_KEY = Symbol("preconnection-agent-skills-store");
const logger = createLogger({
	id: "preconnection-agent-skills-store",
	name: "PreconnectionAgentSkillsStore",
});

export function normalizeAgentSkillsToCommands(skills: Skill[]): AvailableCommand[] {
	const commands: AvailableCommand[] = [];
	const seenNames = new Set<string>();

	for (const skill of skills) {
		const commandName = skill.name;
		if (seenNames.has(commandName)) {
			logger.warn("Skipping duplicate preconnection skill command", {
				agentId: skill.agentId,
				commandName,
				folderName: skill.folderName,
			});
			continue;
		}

		seenNames.add(commandName);
		commands.push({
			name: commandName,
			description: skill.description,
		});
	}

	return commands;
}

export class PreconnectionAgentSkillsStore {
	loading = $state(false);
	loaded = $state(false);
	error = $state<string | null>(null);
	private readonly commandsByAgent = new SvelteMap<string, AvailableCommand[]>();

	initialize(): ResultAsync<void, AppError> {
		if (this.loading || this.loaded) {
			return okAsync(undefined);
		}

		return this.refresh();
	}

	ensureLoaded(): ResultAsync<void, AppError> {
		if (this.loading || this.loaded) {
			return okAsync(undefined);
		}

		return this.refresh();
	}

	refresh(): ResultAsync<void, AppError> {
		if (this.loading) {
			return okAsync(undefined);
		}

		this.loading = true;
		this.error = null;

		return skillsApi
			.listAgentSkills()
			.map((groups) => {
				this.replaceCommands(groups);
				this.loading = false;
				this.loaded = true;
			})
			.mapErr((error) => {
				this.commandsByAgent.clear();
				this.loading = false;
				this.loaded = false;
				this.error = error.message;
				return error;
			});
	}

	getCommandsForAgent(agentId: string | null | undefined): AvailableCommand[] {
		if (!agentId) {
			return [];
		}

		const commands = this.commandsByAgent.get(agentId);
		return commands ? commands : [];
	}

	private replaceCommands(groups: AgentSkillsGroup[]): void {
		this.commandsByAgent.clear();

		for (const group of groups) {
			this.commandsByAgent.set(group.agentId, normalizeAgentSkillsToCommands(group.skills));
		}
	}
}

export function createPreconnectionAgentSkillsStore(): PreconnectionAgentSkillsStore {
	const store = new PreconnectionAgentSkillsStore();
	setContext(PRECONNECTION_AGENT_SKILLS_STORE_KEY, store);
	return store;
}

export function getPreconnectionAgentSkillsStore(): PreconnectionAgentSkillsStore {
	return getContext<PreconnectionAgentSkillsStore>(PRECONNECTION_AGENT_SKILLS_STORE_KEY);
}
