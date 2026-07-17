import { describe, expect, it, vi } from "vitest";

import {
	PanelGitState,
	type PanelGitStateDeps,
} from "../panel-git-state.svelte.js";
import type { TopLevelPanelCloseState } from "../panel-terminal-state.svelte.js";
import type { GitPanel } from "../git-panel-type.js";
import type { WorkspacePanel } from "../types.js";

describe("PanelGitState", () => {
	it("closes a legacy git workspace panel", () => {
		const applyCloseState = vi.fn();
		const workspace: { panels: WorkspacePanel[] } = { panels: [] };
		const state = new PanelGitState({
			getWorkspacePanels: () => workspace.panels,
			setWorkspacePanels: (panels) => {
				workspace.panels = Array.from(panels);
			},
			onPersist: () => {},
			captureTopLevelPanelCloseState: () =>
				({
					nextTopLevelPanelId: null,
					wasFocusedPanel: false,
					wasVisibleSingleModePanel: false,
					wasLegacyFullscreenPanel: false,
				}) satisfies TopLevelPanelCloseState,
			applyTopLevelPanelCloseState: (closeState) => {
				applyCloseState(closeState);
			},
		} satisfies PanelGitStateDeps);

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
