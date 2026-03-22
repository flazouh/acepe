import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ConnectionStore } from "$lib/acp/store/connection-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";

import { PanelHandler } from "../logic/managers/panel-handler.js";

describe("PanelHandler", () => {
	let mockState: MainAppViewState;
	let mockPanelStore: PanelStore;
	let mockSessionStore: SessionStore;
	let mockConnectionStore: ConnectionStore;
	let handler: PanelHandler;

	beforeEach(() => {
		mockState = {} as MainAppViewState;

		mockPanelStore = {
			panels: [{ id: "panel-1", sessionId: "session-1" }],
			closePanel: mock(() => {}),
			resizePanel: mock(() => {}),
			toggleFullscreen: mock(() => {}),
			switchFullscreen: mock(() => {}),
			focusPanel: mock(() => {}),
			spawnPanel: mock(() => ({ id: "panel-1" }) as any),
		} as unknown as PanelStore;

		mockSessionStore = {
			disconnectSession: mock(() => {}),
			connectSession: mock(() => ({ mapErr: mock(() => undefined) })),
			getHotState: mock(() => ({ isConnected: false })),
		} as unknown as SessionStore;

		mockConnectionStore = {
			destroy: mock(() => {}),
		} as unknown as ConnectionStore;

		handler = new PanelHandler(mockState, mockPanelStore, mockSessionStore, mockConnectionStore);
	});

	describe("closePanel", () => {
		it("should disconnect session and destroy connection when panel has session", () => {
			handler.closePanel("panel-1");

			// Should disconnect the session
			expect(mockSessionStore.disconnectSession).toHaveBeenCalledWith("session-1");

			// Should destroy the connection actor
			expect(mockConnectionStore.destroy).toHaveBeenCalledWith("panel-1");

			// Should close the panel
			expect(mockPanelStore.closePanel).toHaveBeenCalledWith("panel-1");
		});

		it("should not disconnect session when panel has no session", () => {
			// Update mock to have panel without session
			mockPanelStore.panels = [{ id: "panel-2", sessionId: null }] as any;

			handler.closePanel("panel-2");

			// Should NOT disconnect any session
			expect(mockSessionStore.disconnectSession).not.toHaveBeenCalled();

			// Should still destroy the connection actor
			expect(mockConnectionStore.destroy).toHaveBeenCalledWith("panel-2");

			// Should close the panel
			expect(mockPanelStore.closePanel).toHaveBeenCalledWith("panel-2");
		});

		it("should handle non-existent panel gracefully", () => {
			mockPanelStore.panels = [];

			handler.closePanel("non-existent");

			// Should NOT disconnect any session
			expect(mockSessionStore.disconnectSession).not.toHaveBeenCalled();

			// Should still attempt to destroy and close (they handle non-existence)
			expect(mockConnectionStore.destroy).toHaveBeenCalledWith("non-existent");
			expect(mockPanelStore.closePanel).toHaveBeenCalledWith("non-existent");
		});
	});

	describe("resizePanel", () => {
		it("should resize panel via store", () => {
			handler.resizePanel("panel-1", 50);
			expect(mockPanelStore.resizePanel).toHaveBeenCalledWith("panel-1", 50);
		});
	});

	describe("toggleFullscreen", () => {
		it("should toggle fullscreen via store", () => {
			handler.toggleFullscreen("panel-1");
			expect(mockPanelStore.toggleFullscreen).toHaveBeenCalledWith("panel-1");
		});
	});

	describe("switchFullscreenPanel", () => {
		it("should switch fullscreen panel via store", () => {
			handler.switchFullscreenPanel("panel-1");
			expect(mockPanelStore.switchFullscreen).toHaveBeenCalledWith("panel-1");
		});
	});

	describe("focusPanel", () => {
		it("should focus panel via store", () => {
			handler.focusPanel("panel-1");
			expect(mockPanelStore.focusPanel).toHaveBeenCalledWith("panel-1");
		});

		it("does not reconnect a disconnected panel session when focused (reconnect removed)", () => {
			handler.focusPanel("panel-1");

			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
		});

		it("does not reconnect an already connected panel session when focused", () => {
			mockSessionStore.getHotState = mock(() => ({ isConnected: true })) as never;

			handler.focusPanel("panel-1");

			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
		});

		it("does not reconnect when the focused panel has no session", () => {
			mockPanelStore.panels = [{ id: "panel-2", sessionId: null }] as never;

			handler.focusPanel("panel-2");

			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
		});
	});

	describe("spawnPanel", () => {
		it("should spawn panel with options", () => {
			const result = handler.spawnPanel({ requireProjectSelection: true });
			expect(mockPanelStore.spawnPanel).toHaveBeenCalledWith({
				requireProjectSelection: true,
			});
			expect(result.id).toBe("panel-1");
		});
	});
});
