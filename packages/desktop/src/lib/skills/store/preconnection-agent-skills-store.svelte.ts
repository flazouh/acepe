import { okAsync, type ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { AvailableCommand } from "$lib/acp/types/available-command.js";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { libraryApi } from "../api/skills-api.js";
import type { LibrarySkillWithSync } from "../types/index.js";

const PRECONNECTION_AGENT_SKILLS_STORE_KEY = Symbol("preconnection-agent-skills-store");
const logger = createLogger({
	id: "preconnection-agent-skills-store",
	name: "PreconnectionAgentSkillsStore",
});

export function normalizeAgentSkillsToCommands(
	skills: LibrarySkillWithSync[],
	agentId: string
): AvailableCommand[] {
	const commands: AvailableCommand[] = [];
	const seenNames = new Set<string>();

	for (const skill of skills) {
		const syncTarget = skill.syncTargets.find((target) => target.agentId === agentId && target.enabled);
		if (!syncTarget) {
			continue;
		}

		const commandName = skill.skill.name;
		if (seenNames.has(commandName)) {
			logger.warn("Skipping duplicate preconnection skill command", {
				agentId,
				commandName,
				skillId: skill.skill.id,
			});
			continue;
		}

		seenNames.add(commandName);
		commands.push({
			name: commandName,
			description: skill.skill.description ? skill.skill.description : "",
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

		return libraryApi
			.listSkillsWithSync()
			.map((skills) => {
				this.replaceCommands(skills);
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

	private replaceCommands(skills: LibrarySkillWithSync[]): void {
		this.commandsByAgent.clear();

		const agentIds = new Set<string>();
		for (const skill of skills) {
			for (const target of skill.syncTargets) {
				if (target.enabled) {
					agentIds.add(target.agentId);
				}
			}
		}

		for (const agentId of agentIds) {
			this.commandsByAgent.set(agentId, normalizeAgentSkillsToCommands(skills, agentId));
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
