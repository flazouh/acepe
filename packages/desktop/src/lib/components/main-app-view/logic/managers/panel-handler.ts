/**
 * Panel Handler - Manages panel operations.
 *
 * Handles all panel-related operations like closing, resizing, fullscreen, etc.
 */

import type { ConnectionStore } from "$lib/acp/store/connection-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { Panel } from "$lib/acp/store/types.js";

import type { MainAppViewState } from "../main-app-view-state.svelte.js";

/**
 * Handles panel operations.
 */
export class PanelHandler {
	/**
	 * Creates a new panel handler.
	 *
	 * @param state - The main app view state
	 * @param panelStore - The panel store
	 * @param sessionStore - The session store (for disconnecting sessions on panel close)
	 * @param connectionStore - The connection store (for destroying XState actors on panel close)
	 */
	constructor(
		private readonly state: MainAppViewState,
		private readonly panelStore: PanelStore,
		private readonly sessionStore: SessionStore,
		private readonly connectionStore: ConnectionStore
	) {}

	/**
	 * Closes a panel and cleans up associated resources.
	 *
	 * This method properly cleans up:
	 * - Session connection (disconnects from ACP)
	 * - XState connection actor (stops and removes)
	 * - Panel state (removes from store)
	 *
	 * @param panelId - The panel ID to close
	 */
	closePanel(panelId: string): void {
		// Get the panel before closing to check for session
		const panel = this.panelStore.panels.find((p) => p.id === panelId);

		// Disconnect session if panel has one
		if (panel?.sessionId) {
			this.sessionStore.disconnectSession(panel.sessionId);
		}

		// Destroy XState connection actor to prevent resource leaks
		this.connectionStore.destroy(panelId);

		// Close the panel (removes from panels array, handles focus/fullscreen)
		this.panelStore.closePanel(panelId);
	}

	/**
	 * Resizes a panel.
	 *
	 * @param panelId - The panel ID to resize
	 * @param delta - The resize delta in pixels
	 */
	resizePanel(panelId: string, delta: number): void {
		this.panelStore.resizePanel(panelId, delta);
	}

	/**
	 * Toggles fullscreen for a panel.
	 *
	 * @param panelId - The panel ID to toggle fullscreen
	 */
	toggleFullscreen(panelId: string): void {
		this.panelStore.toggleFullscreen(panelId);
	}

	/**
	 * Switches fullscreen to a different panel.
	 *
	 * @param panelId - The panel ID to switch fullscreen to
	 */
	switchFullscreenPanel(panelId: string): void {
		this.panelStore.switchFullscreen(panelId);
	}

	/**
	 * Focuses a panel.
	 *
	 * @param panelId - The panel ID to focus
	 */
	focusPanel(panelId: string): void {
		this.panelStore.focusPanel(panelId);
	}

	/**
	 * Spawns a new panel.
	 *
	 * @param options - Panel options
	 * @returns The created panel
	 */
	spawnPanel(options: { requireProjectSelection: boolean }): Panel {
		return this.panelStore.spawnPanel(options);
	}
}
