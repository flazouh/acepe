import { describe, expect, it } from "vitest";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import {
	ATTACHED_COLUMN_WIDTH,
	AgentPanelLayoutController,
} from "../agent-panel-layout-controller.svelte.js";

describe("AgentPanelLayoutController", () => {
	const panelStore = {
		isPlanSidebarExpanded: () => false,
		isBrowserSidebarExpanded: () => false,
		isEmbeddedTerminalDrawerOpen: () => false,
		getHotState: () => null,
		setPlanSidebarExpanded: () => undefined,
		setBrowserSidebarExpanded: () => undefined,
		setEmbeddedTerminalDrawerOpen: () => undefined,
	} as unknown as PanelStore;

	const make = (overrides?: { hasAttachedPane?: boolean; width?: number }) =>
		new AgentPanelLayoutController({
			getPanelId: () => "panel-1",
			getPanelWidth: () => overrides?.width ?? 800,
			getHasAttachedFilePane: () => overrides?.hasAttachedPane ?? false,
			getIsFullscreen: () => false,
			getHasPlan: () => true,
			panelStore,
		});

	it("derives base width from panel width when no attached pane", () => {
		const controller = make({ width: 640 });
		expect(controller.hasAttachedPane).toBe(false);
		expect(controller.baseWidth).toBe(640);
	});

	it("uses attached split width when attached pane is active", () => {
		const controller = make({ hasAttachedPane: true });
		expect(controller.panelRenderWidth).toBe(ATTACHED_COLUMN_WIDTH * 2 + 2);
	});

	it("tracks toolbar minimum width with padding", () => {
		const controller = make({ width: 200 });
		controller.setToolbarMinWidth(300);
		expect(controller.toolbarMinWidthWithPadding).toBe(316);
		expect(controller.baseWidth).toBe(316);
	});

	it("keeps the smallest observed toolbar minimum instead of ratcheting upward", () => {
		const controller = make({ width: 400 });
		controller.setToolbarMinWidth(390);
		controller.setToolbarMinWidth(620);
		expect(controller.toolbarMinWidthWithPadding).toBe(406);
		expect(controller.baseWidth).toBe(406);
	});
});
