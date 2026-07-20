import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelFileState, type PanelFileStateDeps } from "../panel-file-state.svelte.js";
import { createPrependedItemArray } from "../panel-store-array-patches.js";
import type { TopLevelPanelCloseState } from "../panel-terminal-state.svelte.js";
import type { Panel, WorkspacePanel } from "../types.js";

function createOwnerPanel(ownerPanelId: string): Panel {
	return {
		id: ownerPanelId,
		kind: "agent",
		ownerPanelId: null,
		sessionId: null,
		width: 400,
		pendingProjectSelection: false,
		pendingWorktreeEnabled: null,
		preparedWorktreeLaunch: null,
		selectedAgentId: "claude-code",
		projectPath: "/tmp/project",
		agentId: null,
		sourcePath: null,
		worktreePath: null,
		sessionTitle: null,
		autoCreated: false,
	};
}

function createFileState(overrides?: Partial<PanelFileStateDeps>): {
	state: PanelFileState;
	workspacePanels: WorkspacePanel[];
	persist: ReturnType<typeof vi.fn>;
	ownerPanels: Map<string, Panel>;
} {
	let workspacePanels: WorkspacePanel[] = [];
	const persist = vi.fn();
	const ownerPanels = new Map<string, Panel>();

	const deps: PanelFileStateDeps = {
		getWorkspacePanels: () => workspacePanels,
		setWorkspacePanels: (panels) => {
			workspacePanels = Array.from(panels);
		},
		prependWorkspacePanel: (panel) => {
			workspacePanels = createPrependedItemArray(panel, workspacePanels);
		},
		removeWorkspacePanelById: (panelId) => {
			workspacePanels = workspacePanels.filter((panel) => panel.id !== panelId);
		},
		getOwnerPanel: (ownerPanelId) => ownerPanels.get(ownerPanelId),
		patchOwnerPanel: (updatedPanel) => {
			ownerPanels.set(updatedPanel.id, updatedPanel);
		},
		focusOpenedTopLevelPanel: () => {},
		onPersist: () => {
			persist();
		},
		captureTopLevelPanelCloseState: () =>
			({
				nextTopLevelPanelId: null,
				wasFocusedPanel: false,
				wasVisibleSingleModePanel: false,
				wasLegacyFullscreenPanel: false,
			}) satisfies TopLevelPanelCloseState,
		applyTopLevelPanelCloseState: () => {},
	};

	const state = new PanelFileState({ ...deps, ...overrides });
	return { state, workspacePanels, persist, ownerPanels };
}

afterEach(() => {
	if (vi.isFakeTimers()) {
		vi.runOnlyPendingTimers();
		vi.clearAllTimers();
		vi.useRealTimers();
	}
});

describe("PanelFileState", () => {
	it("opens by cache key twice and returns a single panel with switched activation", () => {
		vi.useFakeTimers();
		const ownerId = "owner-panel-1";
		const { state, ownerPanels } = createFileState();
		ownerPanels.set(ownerId, createOwnerPanel(ownerId));

		const firstOpen = state.openFilePanel("src/one.ts", "/tmp/project", {
			ownerPanelId: ownerId,
		});
		const secondOpen = state.openFilePanel("src/one.ts", "/tmp/project", {
			ownerPanelId: ownerId,
		});

		expect(secondOpen.id).toBe(firstOpen.id);
		expect(state.filePanelCount).toBe(1);
		expect(state.getActiveFilePanelId(ownerId)).toBe(firstOpen.id);
	});

	it("switches active attached file before deferred persistence runs", () => {
		vi.useFakeTimers();
		const ownerId = "owner-panel-1";
		const { state, persist, ownerPanels } = createFileState();
		ownerPanels.set(ownerId, createOwnerPanel(ownerId));

		const firstPanel = state.openFilePanel("src/one.ts", "/tmp/project", {
			ownerPanelId: ownerId,
		});
		state.openFilePanel("src/two.ts", "/tmp/project", { ownerPanelId: ownerId });

		vi.runOnlyPendingTimers();
		persist.mockClear();

		state.setActiveAttachedFilePanel(ownerId, firstPanel.id);

		expect(state.getActiveFilePanelId(ownerId)).toBe(firstPanel.id);
		expect(state.getActiveAttachedFilePanel(ownerId)).toBe(firstPanel);
		expect(persist).not.toHaveBeenCalled();

		vi.runOnlyPendingTimers();
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it("removes attached file panels when the owner panel closes", () => {
		const ownerId = "owner-panel-1";
		const { state, ownerPanels } = createFileState();
		ownerPanels.set(ownerId, createOwnerPanel(ownerId));

		state.openFilePanel("src/one.ts", "/tmp/project", { ownerPanelId: ownerId });
		state.openFilePanel("src/two.ts", "/tmp/project", { ownerPanelId: ownerId });

		expect(state.getAttachedFilePanels(ownerId)).toHaveLength(2);

		state.onOwnerPanelClosed(ownerId);

		expect(state.getAttachedFilePanels(ownerId)).toEqual([]);
		expect(state.getActiveFilePanelId(ownerId)).toBeNull();
		expect(state.filePanels.every((panel) => panel.ownerPanelId === null)).toBe(true);
	});
});
