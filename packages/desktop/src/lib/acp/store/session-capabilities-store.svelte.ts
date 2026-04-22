/**
 * Session Capabilities Store - Manages ACP session capabilities.
 *
 * Handles session capabilities (availableModels, availableModes, availableCommands)
 * separately from cold session data. These are populated when connecting to ACP
 * and cleared on disconnect.
 *
 * Uses SvelteMap for fine-grained per-session reactivity: when session A's
 * capabilities change, only components reading session A re-render.
 */

import { SvelteMap } from "svelte/reactivity";
import type { AvailableCommand } from "../types/available-command.js";
import type { ICapabilitiesManager } from "./services/interfaces/capabilities-manager.js";
import type { Mode, Model, SessionCapabilities } from "./types.js";

// Re-export the interface for backwards compatibility
export type { ICapabilitiesManager };

/**
 * Default capabilities for sessions (empty until connected to ACP).
 */
export const DEFAULT_CAPABILITIES: SessionCapabilities = {
	availableModels: [],
	availableModes: [],
	availableCommands: [],
	revision: null,
	pendingMutationId: null,
	previewState: "partial",
};

/**
 * Store for managing session capabilities with direct writes.
 *
 * Uses SvelteMap for fine-grained reactivity - only components reading
 * a specific session's capabilities re-render when that session changes.
 */
export class SessionCapabilitiesStore implements ICapabilitiesManager {
	// Primary capabilities storage with fine-grained per-session reactivity
	// SvelteMap provides fine-grained reactivity without needing $state wrapper
	private capabilities = new SvelteMap<string, SessionCapabilities>();

	/**
	 * Get capabilities for a session.
	 * Returns default capabilities if session has no capabilities set.
	 */
	getCapabilities(sessionId: string): SessionCapabilities {
		return this.capabilities.get(sessionId) ?? DEFAULT_CAPABILITIES;
	}

	/**
	 * Check if a session has capabilities set.
	 */
	hasCapabilities(sessionId: string): boolean {
		return this.capabilities.has(sessionId);
	}

	/**
	 * Update capabilities for a session.
	 * Writes directly to SvelteMap for fine-grained reactivity.
	 */
	updateCapabilities(sessionId: string, updates: Partial<SessionCapabilities>): void {
		const current = this.capabilities.get(sessionId) ?? DEFAULT_CAPABILITIES;
		this.capabilities.set(sessionId, {
			availableModels:
				updates.availableModels === undefined ? current.availableModels : updates.availableModels,
			availableModes:
				updates.availableModes === undefined ? current.availableModes : updates.availableModes,
			availableCommands:
				updates.availableCommands === undefined
					? current.availableCommands
					: updates.availableCommands,
			revision: updates.revision === undefined ? current.revision : updates.revision,
			pendingMutationId:
				updates.pendingMutationId === undefined
					? current.pendingMutationId
					: updates.pendingMutationId,
			previewState:
				updates.previewState === undefined ? current.previewState : updates.previewState,
			modelsDisplay:
				updates.modelsDisplay === undefined ? current.modelsDisplay : updates.modelsDisplay,
			providerMetadata:
				updates.providerMetadata === undefined
					? current.providerMetadata
					: updates.providerMetadata,
		});
	}

	/**
	 * Set full capabilities for a session (immediate).
	 * Use when setting all capabilities at once (e.g., on connect).
	 */
	setCapabilities(
		sessionId: string,
		capabilities: {
			availableModels: Model[];
			availableModes: Mode[];
			availableCommands?: AvailableCommand[];
			providerMetadata?: SessionCapabilities["providerMetadata"];
		}
	): void {
		this.capabilities.set(sessionId, {
			availableModels: capabilities.availableModels,
			availableModes: capabilities.availableModes,
			availableCommands: capabilities.availableCommands ?? [],
			revision: null,
			pendingMutationId: null,
			previewState: "canonical",
			providerMetadata: capabilities.providerMetadata,
		});
	}

	/**
	 * Remove capabilities for a session.
	 * Called on disconnect to clear ACP-specific data.
	 */
	removeCapabilities(sessionId: string): void {
		this.capabilities.delete(sessionId);
	}
}
