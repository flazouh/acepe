import { describe, expect, it, vi } from "vitest";

import {
	PanelTerminalState,
	type PanelTerminalStateDeps,
	type TopLevelPanelCloseState,
} from "../panel-terminal-state.svelte.js";
import type { WorkspacePanel } from "../types.js";

function requireValue<T>(value: T | null): T {
	expect(value).not.toBeNull();
	if (value === null) {
		throw new Error("Expected value");
	}
	return value;
}

function createTerminalState(
	overrides?: Partial<PanelTerminalStateDeps>
): { state: PanelTerminalState; workspacePanels: WorkspacePanel[]; persist: ReturnType<typeof vi.fn> } {
	let workspacePanels: WorkspacePanel[] = [];
	const persist = vi.fn();

	const deps: PanelTerminalStateDeps = {
		getWorkspacePanels: () => workspacePanels,
		setWorkspacePanels: (panels) => {
			workspacePanels = Array.from(panels);
		},
		focusOpenedTopLevelPanel: () => {},
		onPersist: () => {
			persist();
		},
		getFullscreenPanelId: () => null,
		getSelectedSingleModePanelId: () => null,
		switchFullscreen: () => {},
		setFocusedPanelId: () => {},
		captureTopLevelPanelCloseState: () =>
			({
				nextTopLevelPanelId: null,
				wasFocusedPanel: false,
				wasVisibleSingleModePanel: false,
				wasLegacyFullscreenPanel: false,
			}) satisfies TopLevelPanelCloseState,
		applyTopLevelPanelCloseState: () => {},
	};

	const state = new PanelTerminalState({ ...deps, ...overrides });
	return { state, workspacePanels, persist };
}

describe("PanelTerminalState", () => {
	it("creates a terminal group with one selected tab without PanelStore", () => {
		const { state } = createTerminalState();
		const group = state.openTerminalPanel("/tmp/project");

		const tabs = state.getTerminalTabsForGroup(group.id);

		expect(tabs).toHaveLength(1);
		expect(state.getSelectedTerminalTabId(group.id)).toBe(tabs[0]?.id);
		expect(state.terminalPanelCount).toBe(1);
	});

	it("adds a tab and selects it via openTerminalTab", () => {
		const { state } = createTerminalState();
		const group = state.openTerminalPanel("/tmp/project");

		const secondTab = requireValue(state.openTerminalTab(group.id));
		const tabs = state.getTerminalTabsForGroup(group.id);

		expect(tabs).toHaveLength(2);
		expect(tabs[1]?.id).toBe(secondTab.id);
		expect(state.getSelectedTerminalTabId(group.id)).toBe(secondTab.id);
	});

	it("closes the last tab in a group and removes the group", () => {
		const persist = vi.fn();
		const applyCloseState = vi.fn();
		const stateWithClose = new PanelTerminalState({
			getWorkspacePanels: () => [],
			setWorkspacePanels: (panels) => {
				void panels;
			},
			focusOpenedTopLevelPanel: () => {},
			onPersist: () => {
				persist();
			},
			getFullscreenPanelId: () => null,
			getSelectedSingleModePanelId: () => null,
			switchFullscreen: () => {},
			setFocusedPanelId: () => {},
			captureTopLevelPanelCloseState: () => ({
				nextTopLevelPanelId: null,
				wasFocusedPanel: true,
				wasVisibleSingleModePanel: false,
				wasLegacyFullscreenPanel: false,
			}),
			applyTopLevelPanelCloseState: (closeState) => {
				applyCloseState(closeState);
			},
		});

		const group = stateWithClose.openTerminalPanel("/tmp/project");
		const onlyTab = requireValue(stateWithClose.getTerminalTabsForGroup(group.id)[0]);

		stateWithClose.closeTerminalTab(onlyTab.id);

		expect(stateWithClose.getTerminalPanelGroup(group.id)).toBeUndefined();
		expect(stateWithClose.terminalPanelGroups).toEqual([]);
		expect(applyCloseState).toHaveBeenCalledOnce();
	});

	it("attaches a second group for the same project in display order", () => {
		const { state } = createTerminalState();
		const first = state.openTerminalPanel("/tmp/project");
		const firstTab = requireValue(state.openTerminalTab(first.id));
		const secondGroup = requireValue(state.moveTerminalTabToNewPanel(firstTab.id));

		expect(state.getTerminalPanelGroupsForProject("/tmp/project").map((group) => group.id)).toEqual([
			first.id,
			secondGroup.id,
		]);
	});
});
