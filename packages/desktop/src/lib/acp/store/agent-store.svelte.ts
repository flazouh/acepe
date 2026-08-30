/**
 * Agent Store - Manages available agents and agent selection.
 *
 * This store handles loading and managing the list of available AI agents
 * (Claude Code, Cursor, OpenCode, etc.) that can be used in the application.
 */

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { getContext, setContext } from "svelte";
import { toast } from "svelte-sonner";

import type { AppError } from "../errors/app-error.js";
import { rootCauseMessage } from "../errors/error-cause-details.js";
import { createLogger } from "../utils/logger.js";
import { type AgentInfo, api } from "./api.js";
import type { Agent } from "./types.js";

const AGENT_STORE_KEY = Symbol("agent-store");
const logger = createLogger({ id: "agent-store", name: "AgentStore" });

// The one place an AgentInfo from the backend becomes a store Agent. Both
// the list read and the install/uninstall answer go through it, so the two
// paths cannot drift.
const toAgent = (info: AgentInfo): Agent => ({
	id: info.id,
	name: info.name,
	description: info.description,
	icon: info.icon ?? info.id,
	availability_kind: info.availability_kind ?? {
		kind: "installable" as const,
		installed: true,
	},
	default_selection_rank: info.default_selection_rank,
	providerMetadata: info.provider_metadata,
	supportsProjectDiscovery: info.supports_project_discovery ?? false,
});

export type AgentInstallationReadiness =
	| { readonly status: "pending" }
	| { readonly status: "failed"; readonly message: string };

export class AgentStore {
	agents = $state<Agent[]>([]);
	agentsLoading = $state(false);

	/**
	 * The agents whose install is in flight. A set of ids, not a progress
	 * record: agent.install rides the agentCall utility RPC, which is
	 * request/response, and the installer reports nothing between "started"
	 * and "finished". A progress number here would be invented -- the old
	 * record fed a bar that sat at 0% for the whole download.
	 */
	installing = $state<Record<string, true>>({});
	/** Keeps every picker behind the post-install capability-catalog barrier. */
	installationReadiness = $state<Record<string, AgentInstallationReadiness>>({});

	/**
	 * Load available agents from the backend.
	 */
	loadAvailableAgents(): Effect.Effect<Agent[], AppError> {
		this.agentsLoading = true;
		logger.debug("Loading available agents");

		return api.listAgents().pipe(
			Effect.map((agents) => {
				this.agents = agents.map(toAgent);
				this.agentsLoading = false;
				logger.debug("Loaded agents", { count: this.agents.length });
				return this.agents;
			}),
			Effect.mapError((error) => {
				this.agentsLoading = false;
				logger.error("Failed to load agents", error);
				return error;
			})
		);
	}

	/**
	 * Install an automatically provisioned agent.
	 *
	 * The agent list comes back from the same call that did the installing,
	 * re-read backend-side from ProviderRegistry, so this never makes a
	 * second list request that could answer differently.
	 */
	installAgent(agentId: string): Effect.Effect<void, AppError> {
		return Effect.suspend(() => {
			logger.info("Installing agent", { agentId });
			this.installing[agentId] = true;
			return api.installAgent(agentId);
		}).pipe(
			Effect.map((agents) => {
				this.agents = agents.map(toAgent);
				delete this.installing[agentId];
				logger.info("Agent installed successfully", { agentId });
			}),
			Effect.mapError((error) => {
				logger.error("Failed to install agent", error);
				toast.error(`Failed to install agent: ${rootCauseMessage(error)}`);
				delete this.installing[agentId];
				return error;
			})
		);
	}

	/**
	 * Uninstall a previously downloaded agent.
	 */
	async uninstallAgent(agentId: string): Promise<void> {
		logger.info("Uninstalling agent", { agentId });

		const result = await Effect.runPromise(Effect.result(api.uninstallAgent(agentId)));

		if (Result.isSuccess(result)) {
			logger.info("Agent uninstalled", { agentId });
			this.agents = result.success.map(toAgent);
		} else {
			logger.error("Failed to uninstall agent", result.failure);
			toast.error(`Failed to uninstall agent: ${rootCauseMessage(result.failure)}`);
		}
	}

	/**
	 * Check if an agent is currently being installed.
	 */
	isInstalling(agentId: string): boolean {
		return agentId in this.installing;
	}

	beginAgentInstallationReadiness(agentId: string): void {
		this.installationReadiness[agentId] = { status: "pending" };
	}

	failAgentInstallationReadiness(agentId: string, message: string): void {
		this.installationReadiness[agentId] = { status: "failed", message };
	}

	completeAgentInstallationReadiness(agentId: string): void {
		delete this.installationReadiness[agentId];
	}

	getAgentInstallationReadiness(agentId: string): AgentInstallationReadiness | null {
		return this.installationReadiness[agentId] ?? null;
	}

	/**
	 * Get the default agent ID using backend-owned precedence metadata.
	 */
	getDefaultAgentId(): string | null {
		return resolveDefaultAgentId(this.agents);
	}

	getAgent(agentId: string | null | undefined): Agent | null {
		if (!agentId) {
			return null;
		}

		return this.agents.find((agent) => agent.id === agentId) ?? null;
	}

	getProviderMetadata(agentId: string | null | undefined): Agent["providerMetadata"] | null {
		return this.getAgent(agentId)?.providerMetadata ?? null;
	}
}

/**
 * Create and set the agent store in Svelte context.
 */
export function createAgentStore(): AgentStore {
	const store = new AgentStore();
	setContext(AGENT_STORE_KEY, store);
	return store;
}

/**
 * Get the agent store from Svelte context.
 */
export function getAgentStore(): AgentStore {
	return getContext<AgentStore>(AGENT_STORE_KEY);
}

export function resolveDefaultAgentId(agents: readonly Agent[]): string | null {
	let selectedAgentId: string | null = null;
	let selectedRank: number | null = null;

	for (const agent of agents) {
		if (agent.default_selection_rank === undefined) {
			continue;
		}
		if (selectedRank === null || agent.default_selection_rank < selectedRank) {
			selectedAgentId = agent.id;
			selectedRank = agent.default_selection_rank;
		}
	}

	if (selectedAgentId !== null) {
		return selectedAgentId;
	}

	return agents[0]?.id ?? null;
}
