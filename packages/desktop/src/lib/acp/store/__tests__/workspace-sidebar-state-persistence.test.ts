import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";
import type { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";

const saveWorkspaceStateMock = mock(() => okAsync(undefined));
const loadWorkspaceStateMock = mock(() => okAsync(null));

mock.module("../api.js", () => ({
	api: {
		saveWorkspaceState: saveWorkspaceStateMock,
		loadWorkspaceState: loadWorkspaceStateMock,
	},
}));

import { WorkspaceStore } from "../workspace-store.svelte.js";

function createPanelStoreStub(): PanelStore {
	return {
		panels: [],
		filePanels: [],
		terminalPanels: [],
		browserPanels: [],
		scrollX: 0,
		focusedPanelId: null,
		fullscreenPanelId: null,
		fullscreenAuxPanel: null,
		viewMode: "multi",
		focusedViewProjectPath: null,
		embeddedTerminals: {
			serialize: mock(() => []),
			restore: mock(() => {}),
			getSelectedTabId: mock(() => null),
		},
		getActiveFilePanelIdByOwnerPanelIdRecord: mock(() => ({})),
		setActiveFilePanelMap: mock(() => {}),
		setPlanSidebarExpanded: mock(() => {}),
		setMessageDraft: mock(() => {}),
		setPendingReviewRestore: mock(() => {}),
		setEmbeddedTerminalDrawerOpen: mock(() => {}),
		getHotState: mock(() => ({
			planSidebarExpanded: true,
			messageDraft: "",
			reviewMode: false,
			reviewFileIndex: 0,
			embeddedTerminalDrawerOpen: false,
		})),
	} as unknown as PanelStore;
}

function createSessionStoreStub(): SessionStore {
	return {
		getSessionIdentity: mock(() => undefined),
		getSessionMetadata: mock(() => undefined),
	} as unknown as SessionStore;
}

describe("workspace sidebar state persistence", () => {
	beforeEach(() => {
		saveWorkspaceStateMock.mockClear();
		loadWorkspaceStateMock.mockClear();
	});

	it("restores collapsed project paths even when the saved list is empty", () => {
		const store = new WorkspaceStore(createPanelStoreStub(), createSessionStoreStub());
		const restoredValues: string[][] = [];

		store.registerProviders({
			setCollapsedProjectPaths: (paths) => {
				restoredValues.push(paths);
			},
		});

		store.restore({
			version: 9,
			panels: [],
			focusedPanelIndex: null,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
			collapsedProjectPaths: [],
		});

		expect(restoredValues).toEqual([[]]);
	});

	it("can persist sidebar collapse state immediately", () => {
		const store = new WorkspaceStore(createPanelStoreStub(), createSessionStoreStub());

		store.registerProviders({
			getCollapsedProjectPaths: () => ["/workspace/app"],
		});

		store.persist(true);

		expect(saveWorkspaceStateMock).toHaveBeenCalledTimes(1);
		const calls = saveWorkspaceStateMock.mock.calls as unknown as Array<ReadonlyArray<unknown>>;
		const firstCall = calls[0];
		expect(firstCall).toBeDefined();
		const savedState = firstCall?.[0] as Record<string, unknown> | undefined;
		expect(savedState).toMatchObject({
			collapsedProjectPaths: ["/workspace/app"],
		});
	});
});
