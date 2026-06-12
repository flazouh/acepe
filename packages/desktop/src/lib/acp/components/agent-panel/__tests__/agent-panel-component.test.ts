/**
 * Agent panel component wiring characterization (plan 013 U1).
 * Mirrors controller instantiation order from agent-panel.svelte so cross-controller
 * flows stay pinned when composition moves into AgentPanelRootState.
 *
 * check:svelte baseline captured 2026-06-12: 31 errors, 1 warning in 12 files.
 * bun run check: green (tsgo fast config).
 */
import { describe, expect, it } from "bun:test";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import type { ChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import { PanelConnectionState } from "../../../types/panel-connection-state.js";
import { AgentPanelSessionController } from "../state/agent-panel-session-controller.svelte.js";
import { ConnectionController } from "../state/connection-controller.svelte.js";
import { ContentScrollRevealController } from "../state/content-scroll-reveal-controller.svelte.js";
import { AgentPanelViewStateController } from "../state/agent-panel-view-state-controller.svelte.js";
import { AgentPanelScenePipelineController } from "../state/agent-panel-scene-pipeline-controller.svelte.js";
import { WorktreeSetupController } from "../state/worktree-setup-controller.svelte.js";
import { WorktreeCloseConfirmationController } from "../state/worktree-close-confirmation-controller.svelte.js";
import { AgentPanelWorktreeController } from "../state/agent-panel-worktree-controller.svelte.js";

type AgentPanelWiringFixture = {
	sessionController: AgentPanelSessionController;
	connection: ConnectionController;
	contentScrollReveal: ContentScrollRevealController;
	viewStateController: AgentPanelViewStateController;
	scenePipelineController: AgentPanelScenePipelineController;
	worktreeSetup: WorktreeSetupController;
	worktreeCloseConfirm: WorktreeCloseConfirmationController;
	worktreeController: AgentPanelWorktreeController;
	holder: {
		sessionId: string | null;
		panelId: string;
		graphHeaderTitle: string;
		connectionState: PanelConnectionState | null;
	};
};

/**
 * Replicates agent-panel.svelte controller construction order and accessor wiring.
 * Mutual references (sessionController ↔ connection) use the same lazy-closure pattern.
 */
function createAgentPanelWiringFixture(): AgentPanelWiringFixture {
	const stubSessionStore = {
		getSessionConnectionError: () => null,
		getSessionLifecycleFailureReason: () => null,
		getSessionActiveTurnFailure: () => null,
		getSessionAgentPanelSessionSource: () => ({ kind: "uninitialized" }),
		getSessionPendingSendIntent: () => null,
		getSessionTranscriptEntries: () => [],
		getSessionLifecyclePresentation: () => null,
		getSessionAgentPanelCanonicalSource: () => null,
		getSessionIdentity: () => ({
			projectPath: "/repo",
			agentId: "claude-code",
			worktreePath: null,
		}),
		getSessionMetadata: () => ({ title: "Fixture session" }),
		getSessionTurnState: () => "Completed" as const,
		getSessionLastTerminalTurnId: () => "turn-1",
		getActiveStreamingTailRowId: () => null,
		getClockAnchor: () => null,
		getRowTokenStreamByRowId: () => null,
		updateSession: () => undefined,
		disconnectSession: () => undefined,
	} as unknown as SessionStore;

	const stubPanelStore = {
		getHotState: () => null,
		getTopLevelPanel: () => null,
	} as unknown as PanelStore;

	const holder = {
		sessionId: "session-fixture-1" as string | null,
		panelId: "panel-fixture-1",
		graphHeaderTitle: "Fixture graph header",
		connectionState: null as PanelConnectionState | null,
	};

	// Order-sensitive: connection is referenced by sessionController accessors before its `const`.
	const sessionController: AgentPanelSessionController = new AgentPanelSessionController({
		getSessionId: () => holder.sessionId,
		getPanelId: () => holder.panelId,
		sessionStore: stubSessionStore,
		panelStore: stubPanelStore,
		getPanelConnectionState: () => connection.state,
		getPanelConnectionError: () => connection.error,
		getAgentName: () => "Claude",
	});

	const connection: ConnectionController = new ConnectionController({
		getStillFailed: () => sessionController.stillFailed,
	});

	const contentScrollReveal = new ContentScrollRevealController();

	const viewStateController = new AgentPanelViewStateController({
		getViewStateInput: () => ({
			lifecyclePresentation: sessionController.lifecyclePresentation,
			entriesCount: sessionController.knownVisibleEntryCount,
			hasSession: holder.sessionId !== null,
			isAwaitingModelResponse: sessionController.isAwaitingModelResponse,
			hasImmediatePendingSendIntent: sessionController.hasImmediatePendingSendIntent,
			showProjectSelection: false,
			hasEffectiveProjectPath: true,
			errorInfo: sessionController.errorInfo,
		}),
	});

	const scenePipelineController = new AgentPanelScenePipelineController({
		getSessionId: () => holder.sessionId,
		getGraphMaterializerInput: () => ({
			panelId: sessionController.effectivePanelId,
			graph: sessionController.agentPanelCanonicalSource,
			header: {
				title: holder.graphHeaderTitle,
				subtitle: sessionController.sessionTitle,
				agentIconSrc: null,
				agentLabel: "Claude",
				projectLabel: "Fixture project",
				projectColor: "#3b82f6",
				sequenceId: null,
			},
			optimistic: null,
		}),
		sessionStore: stubSessionStore,
		chatPreferencesStore: null as unknown as ChatPreferencesStore,
		getPrefersReducedMotion: () => false,
		contentScrollReveal,
	});

	const worktreeSetup = new WorktreeSetupController();
	const worktreeCloseConfirm = new WorktreeCloseConfirmationController();
	const worktreeController = new AgentPanelWorktreeController({
		getSessionId: () => holder.sessionId,
		getPanelId: () => holder.panelId,
		getSessionWorktreePath: () => sessionController.sessionWorktreePath,
		getSessionProjectPath: () => sessionController.sessionProjectPath,
		getSessionAgentId: () => sessionController.sessionAgentId,
		getWorktreeToggleProjectPath: () => "/repo",
		getHasMessages: () => sessionController.hasMessages,
		getPendingProjectSelection: () => false,
		getPanelPendingWorktreeEnabled: () => null,
		getPanelPreparedWorktreeLaunch: () => null,
		getPendingWorktreeSetup: () => null,
		getAllProjects: () => [],
		panelStore: stubPanelStore,
		sessionStore: stubSessionStore,
		worktreeSetup,
		worktreeCloseConfirm,
		onClose: () => undefined,
		logWorktreeCreated: () => undefined,
		logWorktreeCreatedEarlyReturn: () => undefined,
	});

	return {
		sessionController,
		connection,
		contentScrollReveal,
		viewStateController,
		scenePipelineController,
		worktreeSetup,
		worktreeCloseConfirm,
		worktreeController,
		holder,
	};
}

function deriveShowInlineErrorCard(fixture: AgentPanelWiringFixture): boolean {
	const errorDismissed =
		fixture.sessionController.errorDismissalKey !== null &&
		fixture.connection.dismissedErrorKey === fixture.sessionController.errorDismissalKey;
	return (
		fixture.sessionController.errorInfo.showError &&
		!errorDismissed &&
		fixture.viewStateController.viewState.kind !== "error"
	);
}

describe("AgentPanel component wiring characterization (plan 013 U1)", () => {
	describe("sessionController ↔ connection mutual wiring", () => {
		it("constructs without throw when connection is referenced before its declaration", () => {
			const fixture = createAgentPanelWiringFixture();
			expect(fixture.sessionController.effectivePanelId).toBe("panel-fixture-1");
			expect(fixture.connection.state).toBeNull();
		});

		it("propagates panel ERROR into stillFailed and keeps isRetrying live", () => {
			const fixture = createAgentPanelWiringFixture();
			fixture.connection.state = PanelConnectionState.ERROR;
			expect(fixture.sessionController.stillFailed).toBe(true);
			expect(fixture.connection.isRetrying).toBe(false);
			expect(fixture.connection.beginRetry()).toBe(true);
			expect(fixture.connection.isRetrying).toBe(true);
			fixture.connection.dispose();
		});

		it("clears isRetrying when stillFailed becomes false after connection recovery", () => {
			const fixture = createAgentPanelWiringFixture();
			fixture.connection.state = PanelConnectionState.ERROR;
			fixture.connection.beginRetry();
			expect(fixture.connection.isRetrying).toBe(true);
			fixture.connection.state = PanelConnectionState.CONNECTED;
			expect(fixture.sessionController.stillFailed).toBe(false);
			expect(fixture.connection.isRetrying).toBe(false);
			fixture.connection.dispose();
		});

		it("suppresses inline error card when view state is already the error page", () => {
			const fixture = createAgentPanelWiringFixture();
			fixture.connection.state = PanelConnectionState.ERROR;
			fixture.connection.error = {
				message: "Unable to load session",
				referenceId: null,
				referenceSearchable: false,
			};
			expect(fixture.viewStateController.viewState.kind).toBe("error");
			expect(deriveShowInlineErrorCard(fixture)).toBe(false);
		});
	});

	describe("scene pipeline feed order", () => {
		it("materializes scene header from the graph materializer accessor chain", () => {
			const fixture = createAgentPanelWiringFixture();
			expect(fixture.scenePipelineController.graphMaterializedScene.header.title).toBe(
				"Fixture graph header"
			);
		});

		it("keeps reveal and token-reveal entries aligned with the materialized scene", () => {
			const fixture = createAgentPanelWiringFixture();
			expect(fixture.scenePipelineController.graphSceneEntries).toEqual(
				fixture.scenePipelineController.graphMaterializedScene.conversation.entries
			);
			expect(fixture.scenePipelineController.tokenRevealSceneEntries).toEqual(
				fixture.scenePipelineController.graphSceneEntries
			);
		});

		it("pins scene materializer panelId from sessionController.effectivePanelId", () => {
			const fixture = createAgentPanelWiringFixture();
			expect(fixture.scenePipelineController.graphMaterializedScene.panelId).toBe(
				fixture.sessionController.effectivePanelId
			);
			expect(fixture.scenePipelineController.graphMaterializedScene.panelId).toBe("panel-fixture-1");
		});
	});

	describe("worktree setup ↔ close-confirmation trio", () => {
		it("sequences beginPending → resolve → cancel through the worktree controller", () => {
			const fixture = createAgentPanelWiringFixture();
			fixture.worktreeCloseConfirm.beginPending();
			expect(fixture.worktreeCloseConfirm.confirming).toBe(true);
			expect(fixture.worktreeCloseConfirm.dirtyCheckPending).toBe(true);

			fixture.worktreeCloseConfirm.resolve(true);
			expect(fixture.worktreeCloseConfirm.hasDirtyChanges).toBe(true);
			expect(fixture.worktreeCloseConfirm.dirtyCheckPending).toBe(false);

			fixture.worktreeController.handleWorktreeCloseCancel();
			expect(fixture.worktreeCloseConfirm.confirming).toBe(false);
			expect(fixture.worktreeCloseConfirm.hasDirtyChanges).toBe(false);
		});

		it("starts worktree setup creation when pending setup enters creating-worktree phase", () => {
			const fixture = createAgentPanelWiringFixture();
			fixture.worktreeSetup.startCreation({
				projectPath: "/repo",
				worktreePath: "/repo/.worktrees/feature",
			});
			expect(fixture.worktreeSetup.state?.projectPath).toBe("/repo");
			expect(fixture.worktreeSetup.state?.worktreePath).toBe("/repo/.worktrees/feature");
		});
	});
});
