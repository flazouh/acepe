import { describe, expect, it, vi } from "vitest";

import { PanelBrowserState, type PanelBrowserStateDeps } from "../panel-browser-state.svelte.js";
import type { TopLevelPanelCloseState } from "../panel-terminal-state.svelte.js";
import type { WorkspacePanel } from "../types.js";

vi.mock("../../../utils/tauri-client/browser-webview.js", () => ({
	browserWebview: {
		close: vi.fn(),
	},
}));

function createBrowserState(overrides?: Partial<PanelBrowserStateDeps>): {
	state: PanelBrowserState;
	workspacePanels: WorkspacePanel[];
} {
	let workspacePanels: WorkspacePanel[] = [];

	const deps: PanelBrowserStateDeps = {
		getWorkspacePanels: () => workspacePanels,
		setWorkspacePanels: (panels) => {
			workspacePanels = Array.from(panels);
		},
		focusOpenedTopLevelPanel: () => {},
		onPersist: () => {},
		captureTopLevelPanelCloseState: () =>
			({
				nextTopLevelPanelId: null,
				wasFocusedPanel: false,
				wasVisibleSingleModePanel: false,
				wasLegacyFullscreenPanel: false,
			}) satisfies TopLevelPanelCloseState,
		applyTopLevelPanelCloseState: () => {},
	};

	const state = new PanelBrowserState({ ...deps, ...overrides });
	return { state, workspacePanels };
}

describe("PanelBrowserState", () => {
	it("focuses an existing browser panel for the same project and URL", () => {
		const focus = vi.fn();
		const { state } = createBrowserState({
			focusOpenedTopLevelPanel: (panelId) => {
				focus(panelId);
			},
		});

		const first = state.openBrowserPanel("/tmp/project", "https://example.com");
		const second = state.openBrowserPanel("/tmp/project", "https://example.com");

		expect(second.id).toBe(first.id);
		expect(state.browserPanelCount).toBe(1);
		expect(focus).toHaveBeenCalledTimes(2);
		expect(focus).toHaveBeenLastCalledWith(first.id);
	});
});
