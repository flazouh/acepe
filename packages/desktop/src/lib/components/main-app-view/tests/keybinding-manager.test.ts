import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";

// Mock modules BEFORE any imports that use them

// Mock the zoom service module to avoid $state runtime issues
mock.module("$lib/services/zoom.svelte.js", () => ({
	getZoomService: () => ({
		initialize: () => okAsync(undefined),
		zoomIn: () => okAsync(undefined),
		zoomOut: () => okAsync(undefined),
		resetZoom: () => okAsync(undefined),
		zoomLevel: 1.0,
		zoomPercentage: "100%",
	}),
	resetZoomService: () => {},
}));

// Now import the modules that depend on the mocks
import type { SelectorRegistry } from "$lib/acp/logic/selector-registry.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import { KEYBINDING_ACTIONS } from "$lib/keybindings/constants.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import type { Action } from "$lib/keybindings/types.js";

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";

import { KeybindingManager } from "../logic/managers/keybinding-manager.js";

describe("KeybindingManager", () => {
	type KeybindingState = Pick<
		MainAppViewState,
		| "toggleSettings"
		| "toggleSqlStudio"
		| "toggleTopBar"
		| "commandPaletteOpen"
		| "handleClosePanel"
		| "debugPanelOpen"
		| "sidebarOpen"
	>;
	type KeybindingsServiceLike = Pick<KeybindingsService, "upsertAction">;
	type SelectorRegistryLike = Pick<SelectorRegistry, "toggleFocused" | "cycleFocused">;
	type PanelFocusStore = Pick<PanelStore, "focusedPanelId">;

	let mockState: KeybindingState;
	let mockKeybindingsService: KeybindingsServiceLike;
	let mockSelectorRegistry: SelectorRegistryLike;
	let mockPanelStore: PanelFocusStore;
	let manager: KeybindingManager;
	let upsertActionMock: ReturnType<typeof mock<(action: Action) => void>>;

	beforeEach(() => {
		mockState = {
			toggleSettings: mock(() => {}),
			toggleSqlStudio: mock(() => {}),
			toggleTopBar: mock(() => {}),
			commandPaletteOpen: false,
			handleClosePanel: mock(() => {}),
			debugPanelOpen: false,
			sidebarOpen: false,
		};

		upsertActionMock = mock<(action: Action) => void>(() => {});
		mockKeybindingsService = {
			upsertAction: upsertActionMock,
		};

		mockSelectorRegistry = {
			toggleFocused: mock(() => {}),
			cycleFocused: mock(() => {}),
		};

		mockPanelStore = {
			focusedPanelId: "panel-1",
		};

		manager = new KeybindingManager(
			mockState,
			mockKeybindingsService,
			mockSelectorRegistry,
			mockPanelStore
		);
	});

	describe("registerKeybindings", () => {
		it("should register settings open action", () => {
			manager.registerKeybindings();

			expect(mockKeybindingsService.upsertAction).toHaveBeenCalledWith(
				expect.objectContaining({
					id: KEYBINDING_ACTIONS.SETTINGS_OPEN,
				})
			);
		});

		it("should register command palette toggle action", () => {
			manager.registerKeybindings();

			expect(mockKeybindingsService.upsertAction).toHaveBeenCalledWith(
				expect.objectContaining({
					id: KEYBINDING_ACTIONS.COMMAND_PALETTE_TOGGLE,
				})
			);
		});

		it("should register sql studio open action", () => {
			manager.registerKeybindings();

			expect(mockKeybindingsService.upsertAction).toHaveBeenCalledWith(
				expect.objectContaining({
					id: KEYBINDING_ACTIONS.SQL_STUDIO_OPEN,
				})
			);
		});

		it("should register model selector toggle action", () => {
			manager.registerKeybindings();

			expect(mockKeybindingsService.upsertAction).toHaveBeenCalledWith(
				expect.objectContaining({
					id: KEYBINDING_ACTIONS.SELECTOR_MODEL_TOGGLE,
				})
			);
		});

		it("should register mode selector toggle action", () => {
			manager.registerKeybindings();

			expect(mockKeybindingsService.upsertAction).toHaveBeenCalledWith(
				expect.objectContaining({
					id: KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE,
				})
			);
		});

		it("should register thread create action", () => {
			manager.registerKeybindings();

			expect(mockKeybindingsService.upsertAction).toHaveBeenCalledWith(
				expect.objectContaining({
					id: KEYBINDING_ACTIONS.THREAD_CREATE,
				})
			);
		});

		it("should call toggleSettings on state when settings action triggered", () => {
			manager.registerKeybindings();

			const settingsCall = upsertActionMock.mock.calls.find(
				([action]) => action.id === KEYBINDING_ACTIONS.SETTINGS_OPEN
			);
			expect(settingsCall).toBeDefined();

			settingsCall?.[0].handler();
			expect(mockState.toggleSettings).toHaveBeenCalled();
		});

		it("should toggle command palette when toggle action triggered", () => {
			manager.registerKeybindings();
			const call = upsertActionMock.mock.calls.find(
				([action]) => action.id === KEYBINDING_ACTIONS.COMMAND_PALETTE_TOGGLE
			);
			expect(call).toBeDefined();
			call?.[0].handler();
			expect(mockState.commandPaletteOpen).toBe(true);
		});

		it("should toggle model selector for focused panel", () => {
			manager.registerKeybindings();
			const call = upsertActionMock.mock.calls.find(
				([action]) => action.id === KEYBINDING_ACTIONS.SELECTOR_MODEL_TOGGLE
			);
			expect(call).toBeDefined();
			call?.[0].handler();
			expect(mockSelectorRegistry.toggleFocused).toHaveBeenCalledWith("model", "panel-1");
		});

		it("should cycle mode selector for focused panel", () => {
			manager.registerKeybindings();
			const call = upsertActionMock.mock.calls.find(
				([action]) => action.id === KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE
			);
			expect(call).toBeDefined();
			call?.[0].handler();
			expect(mockSelectorRegistry.cycleFocused).toHaveBeenCalledWith("mode", "panel-1");
		});

		it("should call toggleSqlStudio on state when sql studio action triggered", () => {
			manager.registerKeybindings();

			const sqlStudioCall = upsertActionMock.mock.calls.find(
				([action]) => action.id === KEYBINDING_ACTIONS.SQL_STUDIO_OPEN
			);
			expect(sqlStudioCall).toBeDefined();

			sqlStudioCall?.[0].handler();
			expect(mockState.toggleSqlStudio).toHaveBeenCalled();
		});
	});
});
