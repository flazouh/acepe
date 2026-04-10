import { ResultAsync, okAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { AvailableCommand } from "$lib/acp/types/available-command.js";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { ProviderMetadataProjection } from "$lib/services/acp-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const PRECONNECTION_AGENT_SKILLS_STORE_KEY = Symbol("preconnection-agent-skills-store");
const logger = createLogger({
	id: "preconnection-agent-skills-store",
	name: "PreconnectionAgentSkillsStore",
});

interface WarmablePreconnectionAgent {
	readonly id: string;
	readonly providerMetadata?: ProviderMetadataProjection;
}

type FetchPreconnectionCommands = (
	cwd: string,
	agentId: string
) => ResultAsync<AvailableCommand[], AppError>;

export function normalizePreconnectionCommands(
	commands: ReadonlyArray<AvailableCommand>,
	agentId: string
): AvailableCommand[] {
	const normalized: AvailableCommand[] = [];
	const seenNames = new Set<string>();

	for (const command of commands) {
		if (seenNames.has(command.name)) {
			logger.warn("Skipping duplicate provider-owned preconnection command", {
				agentId,
				commandName: command.name,
			});
			continue;
		}

		seenNames.add(command.name);
		normalized.push({
			name: command.name,
			description: command.description,
			input: command.input,
		});
	}

	return normalized;
}

function isStartupGlobalPreconnectionAgent(agent: WarmablePreconnectionAgent): boolean {
	return agent.providerMetadata?.preconnectionSlashMode === "startupGlobal";
}

export class PreconnectionAgentSkillsStore {
	loading = $state(false);
	loaded = $state(false);
	error = $state<string | null>(null);
	private readonly commandsByAgent = new SvelteMap<string, AvailableCommand[]>();
	private readonly fetchPreconnectionCommands: FetchPreconnectionCommands;

	constructor(fetchPreconnectionCommands?: FetchPreconnectionCommands) {
		this.fetchPreconnectionCommands = fetchPreconnectionCommands
			? fetchPreconnectionCommands
			: tauriClient.acp.listPreconnectionCommands;
	}

	initialize(agents: ReadonlyArray<WarmablePreconnectionAgent>): ResultAsync<void, AppError> {
		if (this.loading || this.loaded) {
			return okAsync(undefined);
		}

		return this.refresh(agents);
	}

	ensureLoaded(agents: ReadonlyArray<WarmablePreconnectionAgent>): ResultAsync<void, AppError> {
		if (this.loading || this.loaded) {
			return okAsync(undefined);
		}

		return this.refresh(agents);
	}

	refresh(agents: ReadonlyArray<WarmablePreconnectionAgent>): ResultAsync<void, AppError> {
		if (this.loading) {
			return okAsync(undefined);
		}

		this.loading = true;
		this.error = null;

		const warmableAgents = agents.filter((agent) => isStartupGlobalPreconnectionAgent(agent));
		if (warmableAgents.length === 0) {
			this.commandsByAgent.clear();
			this.loading = false;
			this.loaded = true;
			return okAsync(undefined);
		}

		return ResultAsync.combine(
			warmableAgents.map((agent) =>
				this.fetchPreconnectionCommands("", agent.id).map((commands) => ({
					agentId: agent.id,
					commands: normalizePreconnectionCommands(commands, agent.id),
				}))
			)
		)
			.map((commandsByAgent) => {
				this.replaceCommands(commandsByAgent);
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

	private replaceCommands(
		commandsByAgent: ReadonlyArray<{
			readonly agentId: string;
			readonly commands: ReadonlyArray<AvailableCommand>;
		}>
	): void {
		this.commandsByAgent.clear();

		for (const group of commandsByAgent) {
			this.commandsByAgent.set(group.agentId, Array.from(group.commands));
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
