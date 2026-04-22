import type { ResultAsync } from "neverthrow";
import { tauriClient } from "../../utils/tauri-client.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import type { AcpError } from "../errors/index.js";
import { ConnectionError } from "../errors/index.js";
/**
 * Information about an available agent
 */
import type { AgentAvailabilityKind } from "../store/types.js";
import { createLogger } from "../utils/logger.js";

export interface AgentInfo {
	id: string;
	name: string;
	icon: string;
	/** Current setup state for this agent (optional for compatibility with store Agent). */
	availability_kind?: AgentAvailabilityKind;
	default_selection_rank?: number;
	supports_project_discovery?: boolean;
}

/**
 * Configuration for a custom agent
 */
export interface CustomAgentConfig {
	id: string;
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}

/**
 * Agent Manager for managing multiple ACP agents.
 *
 * Provides agent discovery, selection, and registration functionality.
 *
 * @example
 * ```typescript
 * const manager = new AgentManager();
 *
 * // List available agents
 * const result = await manager.listAgents();
 * result
 *   .map(agents => console.log('Available agents:', agents))
 *   .mapErr(error => console.error('Error:', error));
 *
 * // Set active agent
 * await manager.setActiveAgent('cursor');
 *
 * // Register custom agent
 * await manager.registerCustomAgent({
 *   id: 'my-agent',
 *   name: 'My Custom Agent',
 *   command: '/path/to/agent',
 *   args: [],
 *   env: {}
 * });
 * ```
 */
export class AgentManager {
	private readonly logger = createLogger({
		id: LOGGER_IDS.AGENT_MANAGER,
		name: "Agent Manager",
	});

	/**
	 * List all available agents (built-in and custom)
	 *
	 * @returns ResultAsync containing array of available agents or an error
	 */
	listAgents(): ResultAsync<AgentInfo[], AcpError> {
		this.logger.debug("listAgents() called");
		return tauriClient.acp
			.listAgents()
			.map((agents) =>
				agents.map((a) => ({
					id: a.id,
					name: a.name,
					icon: a.id,
					availability_kind: a.availability_kind ?? {
						kind: "installable" as const,
						installed: true,
					},
					default_selection_rank: a.default_selection_rank,
					supports_project_discovery: a.supports_project_discovery,
				}))
			)
			.mapErr((error) => {
				this.logger.error("Failed to list agents:", error);
				return new ConnectionError("Failed to list agents", error as Error);
			});
	}

	/**
	 * Register a custom agent
	 *
	 * @param config - The configuration for the custom agent
	 * @returns ResultAsync containing void or an error
	 */
	registerCustomAgent(config: CustomAgentConfig): ResultAsync<void, AcpError> {
		this.logger.debug("registerCustomAgent() called with agentId:", config.id);
		return tauriClient.acp.registerCustomAgent(config).mapErr((error) => {
			this.logger.error("Failed to register custom agent:", error);
			return new ConnectionError(`Failed to register custom agent: ${config.id}`, error as Error);
		});
	}
}
