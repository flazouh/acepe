/**
 * AgentPanelRootState — controller composition spine for agent-panel.svelte.
 *
 * This is intentionally a composition boundary first: it owns controller
 * construction and disposal, while the component keeps the remaining derived
 * view glue until the next architecture units migrate those clusters.
 */

import type { AgentPanelGraphMaterializerInput } from "../../../session-state/agent-panel-graph-materializer-types.js";
import type { ChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import type { ConnectionStore } from "../../../store/connection-store.svelte.js";
import type { InteractionStore } from "../../../store/interaction-store.svelte.js";
import type { MessageQueueStore } from "../../../store/message-queue/index.js";
import type { AgentStore } from "../../../store/agent-store.svelte.js";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { PermissionStore } from "../../../store/permission-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import type { Checkpoint } from "../../../types/checkpoint.js";
import {
	type PanelConnectionErrorDetails,
	type PanelConnectionState,
} from "../../../types/panel-connection-state.js";
import type { PreparedWorktreeLaunch } from "../../../types/worktree-info.js";
import type { Project } from "../../../logic/project-manager.svelte.js";
import type { PanelViewStateInput } from "../../../logic/panel-visibility.js";
import { checkpointStore } from "../../../store/checkpoint-store.svelte.js";
import { createPanelBranchLookupController } from "../logic/panel-branch-lookup.js";
import { loadCheckpointsBeforeTimelineOpen } from "../services/index.js";
import { AgentPanelLayoutController } from "./agent-panel-layout-controller.svelte.js";
import { AgentPanelScenePipelineController } from "./agent-panel-scene-pipeline-controller.svelte.js";
import { AgentPanelSessionController } from "./agent-panel-session-controller.svelte.js";
import { AgentPanelState } from "./agent-panel-state.svelte.js";
import { AgentPanelViewStateController } from "./agent-panel-view-state-controller.svelte.js";
import { AgentPanelWorktreeController } from "./agent-panel-worktree-controller.svelte.js";
import { CheckpointTimelineController } from "./checkpoint-timeline-controller.svelte.js";
import {
	createConnectionController,
	type ConnectionControllerDeps,
} from "./connection-controller.svelte.js";
import { ContentScrollRevealController } from "./content-scroll-reveal-controller.svelte.js";
import { PrCardController } from "./pr-card-controller.svelte.js";
import { ReviewDialogController } from "./review-dialog-controller.svelte.js";
import { WorktreeCloseConfirmationController } from "./worktree-close-confirmation-controller.svelte.js";
import { WorktreeSetupController } from "./worktree-setup-controller.svelte.js";

export interface AgentPanelConnectionController {
	readonly state: PanelConnectionState | null;
	readonly error: PanelConnectionErrorDetails | null;
	readonly dismissedErrorKey: string | null;
	readonly isRetrying: boolean;
	beginRetry(): boolean;
	clearDismissedError(): void;
	dismissError(errorKey: string): void;
	dispose(): void;
}

export interface AgentPanelRootStateStores {
	readonly sessionStore: SessionStore;
	readonly panelStore: PanelStore;
	readonly chatPreferencesStore: ChatPreferencesStore | null;
	readonly connectionStore: ConnectionStore;
	readonly interactionStore: InteractionStore;
	readonly permissionStore: PermissionStore;
	readonly agentStore: AgentStore;
	readonly messageQueueStore: MessageQueueStore;
}

export interface AgentPanelPendingWorktreeSetupSnapshot {
	readonly projectPath: string;
	readonly worktreePath: string | null;
}

export interface AgentPanelRootStateDeps {
	readonly stores: AgentPanelRootStateStores;
	readonly getPanelId: () => string | undefined;
	readonly getSessionId: () => string | null;
	readonly getPanelWidth: () => number | undefined;
	readonly getHasAttachedFilePane: () => boolean;
	readonly getIsFullscreen: () => boolean;
	readonly getReviewMode: () => boolean;
	readonly getHasPlan: () => boolean;
	readonly getAgentName: () => string | null;
	readonly getViewStateInput: (state: AgentPanelRootState) => PanelViewStateInput;
	readonly getGraphMaterializerInput: (
		state: AgentPanelRootState
	) => AgentPanelGraphMaterializerInput;
	readonly getPrefersReducedMotion: () => boolean;
	readonly getWorktreeToggleProjectPath: () => string | null;
	readonly getPanelPendingWorktreeEnabled: () => boolean | null;
	readonly getPanelPreparedWorktreeLaunch: () => PreparedWorktreeLaunch | null;
	readonly getPendingWorktreeSetup: (
		state: AgentPanelRootState
	) => AgentPanelPendingWorktreeSetupSnapshot | null;
	readonly getPendingProjectSelection: () => boolean;
	readonly getAllProjects: () => readonly Project[];
	readonly onClose?: () => void;
	readonly logWorktreeCreated?: (details: Record<string, string | null>) => void;
	readonly logWorktreeCreatedEarlyReturn?: () => void;
	readonly createConnectionController?: (
		deps: ConnectionControllerDeps
	) => AgentPanelConnectionController;
	readonly getCheckpoints?: (sessionId: string) => Checkpoint[];
	readonly loadCheckpoints?: (sessionId: string) => Promise<void>;
}

export class AgentPanelRootState {
	readonly sessionStore: SessionStore;
	readonly panelStore: PanelStore;
	readonly chatPreferencesStore: ChatPreferencesStore | null;
	readonly connectionStore: ConnectionStore;
	readonly interactionStore: InteractionStore;
	readonly permissionStore: PermissionStore;
	readonly agentStore: AgentStore;
	readonly messageQueueStore: MessageQueueStore;

	readonly sessionController: AgentPanelSessionController;
	readonly connection: AgentPanelConnectionController;
	readonly panelState: AgentPanelState;
	readonly panelBranchLookup: ReturnType<typeof createPanelBranchLookupController>;
	readonly layoutController: AgentPanelLayoutController;
	readonly contentScrollReveal: ContentScrollRevealController;
	readonly checkpointTimeline: CheckpointTimelineController;
	readonly worktreeSetup: WorktreeSetupController;
	readonly worktreeCloseConfirm: WorktreeCloseConfirmationController;
	readonly worktreeController: AgentPanelWorktreeController;
	readonly viewStateController: AgentPanelViewStateController;
	readonly scenePipelineController: AgentPanelScenePipelineController;
	readonly prCard: PrCardController;
	readonly reviewDialog: ReviewDialogController;

	constructor(deps: AgentPanelRootStateDeps) {
		this.sessionStore = deps.stores.sessionStore;
		this.panelStore = deps.stores.panelStore;
		this.chatPreferencesStore = deps.stores.chatPreferencesStore;
		this.connectionStore = deps.stores.connectionStore;
		this.interactionStore = deps.stores.interactionStore;
		this.permissionStore = deps.stores.permissionStore;
		this.agentStore = deps.stores.agentStore;
		this.messageQueueStore = deps.stores.messageQueueStore;

		this.sessionController = new AgentPanelSessionController({
			getSessionId: deps.getSessionId,
			getPanelId: deps.getPanelId,
			sessionStore: this.sessionStore,
			panelStore: this.panelStore,
			getPanelConnectionState: () => this.connection.state,
			getPanelConnectionError: () => this.connection.error,
			getAgentName: deps.getAgentName,
		});

		const createConnection = deps.createConnectionController ?? createConnectionController;
		this.connection = createConnection({
			getStillFailed: () => this.sessionController.stillFailed,
			connectionStore: this.connectionStore,
			getPanelId: () => deps.getPanelId() ?? null,
		});

		this.panelState = new AgentPanelState();
		this.panelBranchLookup = createPanelBranchLookupController();

		this.layoutController = new AgentPanelLayoutController({
			getPanelId: deps.getPanelId,
			getPanelWidth: deps.getPanelWidth,
			getHasAttachedFilePane: deps.getHasAttachedFilePane,
			getIsFullscreen: deps.getIsFullscreen,
			getReviewMode: deps.getReviewMode,
			getHasPlan: deps.getHasPlan,
			panelStore: this.panelStore,
		});

		this.contentScrollReveal = new ContentScrollRevealController();

		this.checkpointTimeline = new CheckpointTimelineController({
			getSessionId: deps.getSessionId,
			getCheckpoints: deps.getCheckpoints ?? ((id) => checkpointStore.getCheckpoints(id)),
			loadCheckpoints: deps.loadCheckpoints ?? loadCheckpointsBeforeTimelineOpen,
		});

		this.worktreeSetup = new WorktreeSetupController();
		this.worktreeCloseConfirm = new WorktreeCloseConfirmationController();
		this.worktreeController = new AgentPanelWorktreeController({
			getSessionId: deps.getSessionId,
			getPanelId: deps.getPanelId,
			getSessionWorktreePath: () => this.sessionController.sessionWorktreePath,
			getSessionProjectPath: () => this.sessionController.sessionProjectPath,
			getSessionAgentId: () => this.sessionController.sessionAgentId,
			getWorktreeToggleProjectPath: deps.getWorktreeToggleProjectPath,
			getHasMessages: () => this.sessionController.hasMessages,
			getPendingProjectSelection: deps.getPendingProjectSelection,
			getPanelPendingWorktreeEnabled: deps.getPanelPendingWorktreeEnabled,
			getPanelPreparedWorktreeLaunch: deps.getPanelPreparedWorktreeLaunch,
			getPendingWorktreeSetup: () => deps.getPendingWorktreeSetup(this),
			getAllProjects: deps.getAllProjects,
			panelStore: this.panelStore,
			sessionStore: this.sessionStore,
			worktreeSetup: this.worktreeSetup,
			worktreeCloseConfirm: this.worktreeCloseConfirm,
			onClose: deps.onClose,
			logWorktreeCreated: deps.logWorktreeCreated,
			logWorktreeCreatedEarlyReturn: deps.logWorktreeCreatedEarlyReturn,
		});

		this.viewStateController = new AgentPanelViewStateController({
			getViewStateInput: () => deps.getViewStateInput(this),
		});

		this.scenePipelineController = new AgentPanelScenePipelineController({
			getSessionId: deps.getSessionId,
			getGraphMaterializerInput: () => deps.getGraphMaterializerInput(this),
			sessionStore: this.sessionStore,
			chatPreferencesStore: this.chatPreferencesStore,
			getPrefersReducedMotion: deps.getPrefersReducedMotion,
			contentScrollReveal: this.contentScrollReveal,
		});

		this.prCard = new PrCardController();
		this.reviewDialog = new ReviewDialogController();
	}

	dispose(): void {
		this.connection.dispose();
	}
}
