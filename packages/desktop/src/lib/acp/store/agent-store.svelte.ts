/**
 * Agent Store - Manages available agents and agent selection.
 *
 * This store handles loading and managing the list of available AI agents
 * (Claude Code, Cursor, OpenCode, etc.) that can be used in the application.
 */

import { listen } from "@tauri-apps/api/event";
import type { ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { toast } from "svelte-sonner";

import { resolveProviderMetadataProjection } from "../../services/acp-provider-metadata.js";
import type { AppError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import { api } from "./api.js";
import type { Agent } from "./types.js";

const AGENT_STORE_KEY = Symbol("agent-store");
const logger = createLogger({ id: "agent-store", name: "AgentStore" });

/** Event name for install progress (must match Rust INSTALL_PROGRESS_EVENT). */
const INSTALL_PROGRESS_EVENT = "agent-install:progress";

/** Progress event payload from Rust agent_installer */
interface AgentInstallProgress {
	agent_id: string;
	stage: string;
	progress: number | null;
	message: string;
}

export class AgentStore {
	agents = $state<Agent[]>([]);
	agentsLoading = $state(false);

	/** Tracks install progress per agent ID */
	installing = $state<Record<string, { stage: string; progress: number }>>({});

	private unlistenProgress: (() => void) | null = null;
	/** Resolves when the progress event listener is registered. */
	private listenerReady: Promise<void>;

	constructor() {
		this.listenerReady = this.listenToProgressEvents();
	}

	private async listenToProgressEvents(): Promise<void> {
		const unlisten = await listen<AgentInstallProgress>(INSTALL_PROGRESS_EVENT, (event) => {
			const { agent_id, stage, progress, message } = event.payload;
			logger.debug("Install progress", { agent_id, stage, progress, message });

			if (stage === "complete") {
				// Remove from installing state
				const { [agent_id]: _, ...rest } = this.installing;
				this.installing = rest;
			} else {
				this.installing = {
					...this.installing,
					[agent_id]: { stage, progress: progress ?? 0 },
				};
			}
		});
		this.unlistenProgress = unlisten;
	}

	/**
	 * Load available agents from the backend.
	 */
	loadAvailableAgents(): ResultAsync<Agent[], AppError> {
		this.agentsLoading = true;
		logger.debug("Loading available agents");

		return api
			.listAgents()
			.map((agents) => {
				this.agents = agents.map((a) => ({
					id: a.id,
					name: a.name,
					description: a.description,
					icon: a.icon ?? a.id,
					availability_kind: a.availability_kind ?? {
						kind: "installable" as const,
						installed: true,
					},
					autonomous_supported_mode_ids: a.autonomous_supported_mode_ids
						? a.autonomous_supported_mode_ids
						: [],
					default_selection_rank: a.default_selection_rank,
					providerMetadata: resolveProviderMetadataProjection(a.id, a.provider_metadata, a.id),
					supportsProjectDiscovery: a.supports_project_discovery ?? false,
				}));
				this.agentsLoading = false;
				logger.debug("Loaded agents", { count: this.agents.length });
				return this.agents;
			})
			.mapErr((error) => {
				this.agentsLoading = false;
				logger.error("Failed to load agents", error);
				return error;
			});
	}

	/**
	 * Install an automatically provisioned agent.
	 */
	async installAgent(agentId: string): Promise<void> {
		// Ensure progress listener is registered before starting install
		await this.listenerReady;

		logger.info("Installing agent", { agentId });
		this.installing = {
			...this.installing,
			[agentId]: { stage: "starting", progress: 0 },
		};

		const result = await api.installAgent(agentId);

		if (result.isOk()) {
			logger.info("Agent installed successfully", { agentId });
			// Refresh agent list to pick up new availability
			await this.loadAvailableAgents();
		} else {
			logger.error("Failed to install agent", result.error);
			toast.error(`Failed to install agent: ${result.error.message}`);
			// Clear installing state on error
			const { [agentId]: _, ...rest } = this.installing;
			this.installing = rest;
		}
	}

	/**
	 * Uninstall a previously downloaded agent.
	 */
	async uninstallAgent(agentId: string): Promise<void> {
		logger.info("Uninstalling agent", { agentId });

		const result = await api.uninstallAgent(agentId);

		if (result.isOk()) {
			logger.info("Agent uninstalled", { agentId });
			await this.loadAvailableAgents();
		} else {
			logger.error("Failed to uninstall agent", result.error);
			toast.error(`Failed to uninstall agent: ${result.error.message}`);
		}
	}

	/**
	 * Check if an agent is currently being installed.
	 */
	isInstalling(agentId: string): boolean {
		return agentId in this.installing;
	}

	/**
	 * Get the default agent ID using backend-owned precedence metadata.
	 */
	getDefaultAgentId(): string | null {
		return resolveDefaultAgentId(this.agents);
	}

	destroy() {
		this.unlistenProgress?.();
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
