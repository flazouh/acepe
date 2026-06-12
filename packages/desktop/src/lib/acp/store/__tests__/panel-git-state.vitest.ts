import { describe, expect, it, vi } from "vitest";

import {
	PanelGitState,
	type PanelGitStateDeps,
} from "../panel-git-state.svelte.js";
import type { TopLevelPanelCloseState } from "../panel-terminal-state.svelte.js";
import type { GitPanel } from "../git-panel-type.js";
import type { WorkspacePanel } from "../types.js";

function createGitState(
	overrides?: Partial<PanelGitStateDeps>
): { state: PanelGitState; workspacePanels: WorkspacePanel[]; persist: ReturnType<typeof vi.fn> } {
	let workspacePanels: WorkspacePanel[] = [];
	const persist = vi.fn();

	const deps: PanelGitStateDeps = {
		getWorkspacePanels: () => workspacePanels,
		setWorkspacePanels: (panels) => {
			workspacePanels = Array.from(panels);
		},
		onPersist: () => {
			persist();
		},
		getViewMode: () => "multi",
		setFocusedViewProjectPath: () => {},
		setScrollX: () => {},
		captureTopLevelPanelCloseState: () =>
			({
				nextTopLevelPanelId: null,
				wasFocusedPanel: false,
				wasVisibleSingleModePanel: false,
				wasLegacyFullscreenPanel: false,
			}) satisfies TopLevelPanelCloseState,
		applyTopLevelPanelCloseState: () => {},
	};

	const state = new PanelGitState({ ...deps, ...overrides });
	return { state, workspacePanels, persist };
}

describe("PanelGitState", () => {
	it("opens and closes the git dialog without PanelStore", () => {
		const { state, persist } = createGitState();

		const dialog = state.openGitDialog("/tmp/project");
		expect(state.gitDialog).toEqual({
			id: dialog.id,
			projectPath: "/tmp/project",
			width: dialog.width,
		});

		state.closeGitDialog();
		expect(state.gitDialog).toBeNull();
		expect(persist).toHaveBeenCalledTimes(2);
	});

	it("closes a legacy git workspace panel", () => {
		const applyCloseState = vi.fn();
		const workspace: { panels: WorkspacePanel[] } = { panels: [] };
		const state = new PanelGitState({
			getWorkspacePanels: () => workspace.panels,
			setWorkspacePanels: (panels) => {
				workspace.panels = Array.from(panels);
			},
			onPersist: () => {},
			getViewMode: () => "multi",
			setFocusedViewProjectPath: () => {},
			setScrollX: () => {},
			captureTopLevelPanelCloseState: () => ({
				nextTopLevelPanelId: null,
				wasFocusedPanel: false,
				wasVisibleSingleModePanel: false,
				wasLegacyFullscreenPanel: false,
			}),
			applyTopLevelPanelCloseState: (closeState) => {
				applyCloseState(closeState);
			},
		});

		const gitPanel: GitPanel = {
			id: "git-panel-1",
			kind: "git",
			projectPath: "/tmp/project",
			width: 400,
			ownerPanelId: null,
		};
		state.gitPanels = [gitPanel];
		expect(state.gitPanels).toEqual([gitPanel]);
		expect(state.gitPanelCount).toBe(1);
		expect(workspace.panels).toEqual([gitPanel]);

		state.closeLegacyGitPanel(gitPanel.id);

		expect(state.gitPanels).toEqual([]);
		expect(workspace.panels).toEqual([]);
		expect(applyCloseState).toHaveBeenCalledOnce();
	});
});
