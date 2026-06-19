import { describe, expect, it, vi } from "vitest";
import { PanelConnectionState } from "../../../../types/panel-connection-state.js";
import {
	AgentPanelRootState,
	type AgentPanelConnectionController,
	type AgentPanelRootStateDeps,
	type AgentPanelRootStateStores,
} from "../agent-panel-root-state.svelte.js";
import { planningDebugSourceCountForTest } from "../planning-debug.js";

function createConnectionFake(disposeLog: string[]): AgentPanelConnectionController {
	return {
		get state() {
			return PanelConnectionState.IDLE;
		},
		get error() {
			return null;
		},
		get dismissedErrorKey() {
			return null;
		},
		get isRetrying() {
			return false;
		},
		beginRetry: () => true,
		clearDismissedError: () => undefined,
		dismissError: () => undefined,
		dispose: () => {
			disposeLog.push("connection");
		},
	};
}

function createStoreStubs(): AgentPanelRootStateStores {
	return {
		sessionStore: {
			read: {},
			write: {},
			connection: {},
			presentation: {},
		} as never,
		panelStore: {
			getHotState: () => null,
			isPlanSidebarExpanded: () => false,
			isBrowserSidebarExpanded: () => false,
			isEmbeddedTerminalDrawerOpen: () => false,
			setPlanSidebarExpanded: () => undefined,
			setBrowserSidebarExpanded: () => undefined,
			setEmbeddedTerminalDrawerOpen: () => undefined,
		} as never,
		chatPreferencesStore: null,
		connectionStore: {} as never,
		interactionStore: {} as never,
		permissionStore: {} as never,
		agentStore: {} as never,
		messageQueueStore: {} as never,
	};
}

function createRootStateDeps(
	disposeLog: string[],
	overrides: Partial<AgentPanelRootStateDeps> = {}
): AgentPanelRootStateDeps {
	return {
		stores: createStoreStubs(),
		getPanelId: () => "panel-1",
		getSessionId: () => "session-1",
		getPanelWidth: () => 720,
		getHasAttachedFilePane: () => false,
		getIsFullscreen: () => false,
		getReviewMode: () => false,
		getHasPlan: () => false,
		getAgentName: () => null,
		getViewStateInput: () => ({
			lifecyclePresentation: null,
			entriesCount: 0,
			hasSession: false,
			isAwaitingModelResponse: false,
			hasImmediatePendingSendIntent: false,
			showProjectSelection: false,
			hasEffectiveProjectPath: false,
			errorInfo: {
				showError: false,
				variant: "inline",
				title: "",
				summary: null,
				details: null,
				referenceId: null,
				referenceSearchable: false,
				failureReason: null,
			},
		}),
		getGraphMaterializerInput: () => ({
			panelId: "panel-1",
			graph: null,
			header: {
				title: "",
				subtitle: null,
				agentIconSrc: null,
				agentLabel: null,
				projectLabel: "Project",
				projectColor: "#000000",
				sequenceId: null,
			},
			optimistic: null,
		}),
		getPrefersReducedMotion: () => false,
		getWorktreeToggleProjectPath: () => null,
		getPanelPendingWorktreeEnabled: () => null,
		getPanelPreparedWorktreeLaunch: () => null,
		getPendingWorktreeSetup: () => null,
		getPendingProjectSelection: () => false,
		getAllProjects: () => [],
		createConnectionController: () => createConnectionFake(disposeLog),
		loadCheckpoints: async () => undefined,
		getCheckpoints: () => [],
		...overrides,
	};
}

describe("AgentPanelRootState.dispose", () => {
	it("disposes connection and sessionController", () => {
		const disposeLog: string[] = [];
		const root = new AgentPanelRootState(createRootStateDeps(disposeLog));
		const sessionDispose = vi.spyOn(root.sessionController, "dispose");

		root.dispose();

		expect(disposeLog).toEqual(["connection"]);
		expect(sessionDispose).toHaveBeenCalledTimes(1);
	});

	it("returns the planning-debug registry to its pre-construct baseline", () => {
		const baseline = planningDebugSourceCountForTest();
		const root = new AgentPanelRootState(createRootStateDeps([]));

		expect(planningDebugSourceCountForTest()).toBe(baseline + 1);

		root.dispose();

		expect(planningDebugSourceCountForTest()).toBe(baseline);
	});

	it("keeps the registry stable across repeated construct-dispose cycles", () => {
		const baseline = planningDebugSourceCountForTest();

		for (let cycle = 0; cycle < 3; cycle += 1) {
			const root = new AgentPanelRootState(createRootStateDeps([]));
			expect(planningDebugSourceCountForTest()).toBe(baseline + 1);
			root.dispose();
			expect(planningDebugSourceCountForTest()).toBe(baseline);
		}
	});

	it("allows double-dispose without throwing", () => {
		const root = new AgentPanelRootState(createRootStateDeps([]));

		expect(() => {
			root.dispose();
			root.dispose();
		}).not.toThrow();
	});
});
