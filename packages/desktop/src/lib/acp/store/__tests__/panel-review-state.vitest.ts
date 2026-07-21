import { describe, expect, it, vi } from "vitest";

import type { ModifiedFilesState } from "../../types/modified-files-state.js";
import { PanelReviewState, type PanelReviewStateDeps } from "../panel-review-state.svelte.js";
import type { TopLevelPanelCloseState } from "../panel-terminal-state.svelte.js";
import type { WorkspacePanel } from "../types.js";

function createModifiedFilesState(): ModifiedFilesState {
	return {
		files: [],
		byPath: new Map(),
		fileCount: 0,
		totalEditCount: 0,
	};
}

function createReviewState(overrides?: Partial<PanelReviewStateDeps>): {
	state: PanelReviewState;
	workspacePanels: WorkspacePanel[];
} {
	let workspacePanels: WorkspacePanel[] = [];

	const deps: PanelReviewStateDeps = {
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

	const state = new PanelReviewState({ ...deps, ...overrides });
	return { state, workspacePanels };
}

describe("PanelReviewState", () => {
	it("opens one review panel per project path", () => {
		const focus = vi.fn();
		const { state } = createReviewState({
			focusOpenedTopLevelPanel: (panelId) => {
				focus(panelId);
			},
		});

		const first = state.openReviewPanel("/tmp/project", createModifiedFilesState());
		const second = state.openReviewPanel("/tmp/project", createModifiedFilesState(), 2);

		expect(second.id).toBe(first.id);
		expect(state.reviewPanelCount).toBe(1);
		expect(focus).toHaveBeenCalledTimes(2);
	});
});
