import { describe, expect, it } from "vitest";
import { PanelConnectionState } from "../../../../types/panel-connection-state.js";
import {
	AgentPanelRootState,
	type AgentPanelConnectionController,
	type AgentPanelRootStateDeps,
	type AgentPanelRootStateStores,
} from "../agent-panel-root-state.svelte.js";
import { AgentPanelLayoutController } from "../agent-panel-layout-controller.svelte.js";
import { AgentPanelScenePipelineController } from "../agent-panel-scene-pipeline-controller.svelte.js";
import { AgentPanelSessionController } from "../agent-panel-session-controller.svelte.js";
import { AgentPanelViewStateController } from "../agent-panel-view-state-controller.svelte.js";
import { AgentPanelWorktreeController } from "../agent-panel-worktree-controller.svelte.js";
import { CheckpointTimelineController } from "../checkpoint-timeline-controller.svelte.js";
import { ContentScrollRevealController } from "../content-scroll-reveal-controller.svelte.js";
import { PrCardController } from "../pr-card-controller.svelte.js";
import { ReviewDialogController } from "../review-dialog-controller.svelte.js";
import { WorktreeCloseConfirmationController } from "../worktree-close-confirmation-controller.svelte.js";
import { WorktreeSetupController } from "../worktree-setup-controller.svelte.js";

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

describe("AgentPanelRootState", () => {
	it("owns the agent panel controller spine behind one root object", () => {
		const disposeLog: string[] = [];
		const root = new AgentPanelRootState({
			stores: createStoreStubs(),
			getPanelId: () => "panel-1",
			getSessionId: () => null,
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
		});

		expect(root.sessionController).toBeInstanceOf(AgentPanelSessionController);
		expect(root.layoutController).toBeInstanceOf(AgentPanelLayoutController);
		expect(root.contentScrollReveal).toBeInstanceOf(ContentScrollRevealController);
		expect(root.checkpointTimeline).toBeInstanceOf(CheckpointTimelineController);
		expect(root.worktreeSetup).toBeInstanceOf(WorktreeSetupController);
		expect(root.worktreeCloseConfirm).toBeInstanceOf(WorktreeCloseConfirmationController);
		expect(root.worktreeController).toBeInstanceOf(AgentPanelWorktreeController);
		expect(root.viewStateController).toBeInstanceOf(AgentPanelViewStateController);
		expect(root.scenePipelineController).toBeInstanceOf(AgentPanelScenePipelineController);
		expect(root.prCard).toBeInstanceOf(PrCardController);
		expect(root.reviewDialog).toBeInstanceOf(ReviewDialogController);

		root.dispose();
		expect(disposeLog).toEqual(["connection"]);
	});
});