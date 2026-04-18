/**
 * Keybinding Manager - Manages keybinding registration.
 *
 * Handles registration of all keybindings for the main app view.
 */

import type { SelectorRegistry } from "$lib/acp/logic/selector-registry.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import { KEYBINDING_ACTIONS } from "$lib/keybindings/constants.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import { getZoomService } from "$lib/services/zoom.svelte.js";

import type { MainAppViewState } from "../main-app-view-state.svelte.js";

type KeybindingState = Pick<
	MainAppViewState,
	| "toggleSettings"
	| "toggleSqlStudio"
	| "toggleTopBar"
	| "commandPaletteOpen"
	| "handleClosePanel"
	| "debugPanelOpen"
	| "sidebarOpen"
	| "toggleFileExplorer"
>;
type KeybindingServiceLike = Pick<KeybindingsService, "upsertAction">;
type SelectorRegistryLike = Pick<SelectorRegistry, "toggleFocused" | "cycleFocused">;
type PanelFocusStore = Pick<PanelStore, "focusedPanelId">;

/**
 * Handles keybinding registration.
 */
export class KeybindingManager {
	/**
	 * Creates a new keybinding manager.
	 *
	 * @param state - The main app view state
	 * @param keybindingsService - The keybindings service
	 * @param selectorRegistry - The selector registry
	 * @param panelStore - The panel store
	 */
	constructor(
		private readonly state: KeybindingState,
		private readonly keybindingsService: KeybindingServiceLike,
		private readonly selectorRegistry: SelectorRegistryLike,
		private readonly panelStore: PanelFocusStore
	) {}

	/**
	 * Registers all keybindings for the main app view.
	 */
	registerKeybindings(): void {
		// Settings toggle - directly toggles overlay state (no $app/navigation needed)
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.SETTINGS_OPEN,
			label: "Open Settings",
			category: "navigation",
			handler: () => {
				this.state.toggleSettings();
			},
		});

		// SQL Studio toggle
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.SQL_STUDIO_OPEN,
			label: "Open SQL Studio",
			category: "navigation",
			handler: () => {
				this.state.toggleSqlStudio();
			},
		});

		// Command palette toggle
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.COMMAND_PALETTE_TOGGLE,
			label: "Toggle Command Palette",
			category: "navigation",
			handler: () => {
				this.state.commandPaletteOpen = !this.state.commandPaletteOpen;
			},
		});

		// Model selector toggle
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.SELECTOR_MODEL_TOGGLE,
			label: "Toggle Model Selector",
			description: "Open or close the model selector dropdown",
			category: "selection",
			handler: () => {
				this.selectorRegistry.toggleFocused("model", this.panelStore.focusedPanelId);
			},
		});

		// Mode selector cycle (Cmd+. cycles through modes instead of opening dropdown)
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE,
			label: "Toggle Mode Selector",
			description: "Open or close the mode selector dropdown",
			category: "selection",
			handler: () => {
				this.selectorRegistry.cycleFocused("mode", this.panelStore.focusedPanelId);
			},
		});

		// Thread create - handler will be set by initialization manager
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.THREAD_CREATE,
			label: "Create New Thread",
			description: "Create a new conversation thread",
			category: "navigation",
			handler: () => {
				// Handler will be set by state class
			},
		});

		// Thread close - close the focused panel
		// Note: "when" context check is already on the keybinding, not needed on the action
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.THREAD_CLOSE,
			label: "Close Thread",
			description: "Close the currently focused thread panel",
			category: "navigation",
			handler: () => {
				const focusedPanelId = this.panelStore.focusedPanelId;
				if (focusedPanelId) {
					this.state.handleClosePanel(focusedPanelId);
				}
			},
		});

		// Debug panel toggle
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.DEBUG_TOGGLE,
			label: "Toggle Debug Panel",
			category: "view",
			handler: () => {
				this.state.debugPanelOpen = !this.state.debugPanelOpen;
			},
		});

		// Sidebar toggle
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.SIDEBAR_TOGGLE,
			label: "Toggle Sidebar",
			description: "Show or hide the sidebar",
			category: "view",
			handler: () => {
				this.state.sidebarOpen = !this.state.sidebarOpen;
			},
		});

		// Top bar toggle
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.TOP_BAR_TOGGLE,
			label: "Toggle Top Bar",
			category: "view",
			handler: () => {
				this.state.toggleTopBar();
			},
		});

		// Zoom actions
		const zoomService = getZoomService();

		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.ZOOM_IN,
			label: "Zoom In",
			description: "Increase the zoom level",
			category: "view",
			handler: () => {
				zoomService.zoomIn();
			},
		});

		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.ZOOM_OUT,
			label: "Zoom Out",
			description: "Decrease the zoom level",
			category: "view",
			handler: () => {
				zoomService.zoomOut();
			},
		});

		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.ZOOM_RESET,
			label: "Reset Zoom",
			description: "Reset zoom to 100%",
			category: "view",
			handler: () => {
				zoomService.resetZoom();
			},
		});

		// Urgency jump - handler will be set by main-app-view
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.URGENCY_JUMP_FIRST,
			label: "Jump to Urgent",
			description: "Focus the most urgent tab (asking question or error)",
			category: "navigation",
			handler: () => {
				// Handler will be set by main-app-view
			},
		});

		// File explorer toggle
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.FILE_EXPLORER_TOGGLE,
			label: "Toggle File Explorer",
			category: "navigation",
			handler: () => {
				this.state.toggleFileExplorer();
			},
		});
	}

	/**
	 * Updates the thread create handler.
	 *
	 * @param handler - The handler function
	 */
	setThreadCreateHandler(handler: () => void): void {
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.THREAD_CREATE,
			label: "Create New Thread",
			description: "Create a new conversation thread",
			category: "navigation",
			handler,
		});
	}

	/**
	 * Updates the urgency jump handler.
	 *
	 * @param handler - The handler function that jumps to the most urgent tab
	 */
	setUrgencyJumpHandler(handler: () => void): void {
		this.keybindingsService.upsertAction({
			id: KEYBINDING_ACTIONS.URGENCY_JUMP_FIRST,
			label: "Jump to Urgent",
			description: "Focus the most urgent tab (asking question or error)",
			category: "navigation",
			handler,
		});
	}
}
