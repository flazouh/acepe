<script lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { okAsync, ResultAsync } from "neverthrow";
import { FolderPlus } from "phosphor-svelte";
import { onDestroy, onMount } from "svelte";
import { toast } from "svelte-sonner";
import OpenProjectDialog from "$lib/acp/components/add-repository/open-project-dialog.svelte";
import DiffViewerModal from "$lib/acp/components/diff-viewer/diff-viewer-modal.svelte";
import { TabBar } from "$lib/acp/components/tab-bar/index.js";
import { WelcomeScreen } from "$lib/acp/components/welcome-screen/index.js";
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
import { LOGGER_IDS } from "$lib/acp/constants/logger-ids.js";
import { useAdvancedCommandPalette } from "$lib/acp/hooks/use-advanced-command-palette.svelte.js";
import { InboundRequestHandler } from "$lib/acp/logic/inbound-request-handler.js";
import { ProjectClient } from "$lib/acp/logic/project-client.js";
import { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { SessionDomainEventSubscriber } from "$lib/acp/logic/index.js";
import { setSelectorRegistryContext } from "$lib/acp/logic/selector-registry.svelte.js";
import {
	agentModelPreferencesStore,
	createAgentPreferencesStore,
	createAgentStore,
	createChatPreferencesStore,
	createConnectionStore,
	createInteractionStore,
	createMessageQueueStore,
	createPanelStore,
	createPermissionStore,
	createPlanPreferenceStore,
	createPlanStore,
	createQuestionStore,
	createQueueStore,
	createReviewPreferenceStore,
	createSessionStore,
	LiveInteractionProjectionSync,
	SessionProjectionHydrator,
	createTabBarStore,
	createUnseenStore,
	createUrgencyTabsStore,
	createWorkspaceStore,
	getConnectionStore,
	gitHubDiffViewerStore,
} from "$lib/acp/store/index.js";
import { enrichExistingToolCallFromPermission } from "$lib/acp/store/services/permission-tool-call-enricher.js";
import { createQuestionSelectionStore } from "$lib/acp/store/question-selection-store.svelte.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import { buildPlanApprovalInteractionId } from "$lib/acp/types/interaction.js";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { ThemeProvider } from "$lib/components/theme/index.js";
import DesignSystemShowcase from "$lib/components/dev/design-system-showcase.svelte";
import { KEYBINDING_ACTIONS } from "$lib/keybindings/constants.js";
import { getKeybindingsService } from "$lib/keybindings/index.js";
import {
	COMPLETION_ACTIONS,
	dismissWhere,
	PERMISSION_ACTIONS,
	QUESTION_ACTIONS,
	showNotification,
} from "$lib/notifications/notification-state.js";
import * as m from "$lib/paraglide/messages.js";
import type { PlanData } from "$lib/services/converted-session-types.js";
import { createPreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";
import { createDismissedTipsStore } from "$lib/stores/dismissed-tips-store.svelte.js";
import { createNotificationPreferencesStore } from "$lib/stores/notification-preferences-store.svelte.js";
import { createVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";
import { createWindowFocusStore } from "$lib/stores/window-focus-store.svelte.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { playSound, preloadSound } from "$lib/acp/utils/sound.js";
import { SoundEffect } from "$lib/acp/types/sounds.js";
import { ChangelogModal } from "./changelog-modal/index.js";
import { FileExplorerModal } from "$lib/acp/components/file-explorer-modal/index.js";
import EmptyStates from "./main-app-view/components/content/empty-states.svelte";
import PanelsContainer from "./main-app-view/components/content/panels-container.svelte";
import AppOverlays from "./main-app-view/components/overlays/app-overlays.svelte";
import SourceControlDialog from "./main-app-view/components/overlays/source-control-dialog.svelte";
import AppSidebar from "./main-app-view/components/sidebar/app-sidebar.svelte";
import {
	buildFileExplorerProjectInfoByPath,
	buildFileExplorerProjectPaths,
} from "./main-app-view/logic/file-explorer-context.js";
import { MainAppViewState } from "./main-app-view/logic/main-app-view-state.svelte.js";
import { applyDownloadEventToProgress } from "./main-app-view/logic/update-download-progress.js";
import {
	applyUpdaterDownloadEvent,
	canMaximizeFromStartupGate,
	createAvailableUpdaterState,
	createCheckingUpdaterState,
	createErrorUpdaterState,
	createIdleUpdaterState,
	createDownloadingUpdaterState,
	createInstallingUpdaterState,
	getUpdaterPrimaryAction,
	shouldShowBlockingUpdaterOverlay,
	type UpdaterBannerState,
} from "./main-app-view/logic/updater-state.js";
import {
	downloadAndInstallUpdate,
	installDownloadedUpdate,
	predownloadUpdate,
} from "./main-app-view/logic/updater-workflow.js";
import { ReviewFullscreenPage } from "./review-fullscreen/index.js";
import { SettingsPage } from "./settings-page/index.js";
import SqlStudioPage from "./sql-studio/sql-studio-page.svelte";
import { TopBar } from "./top-bar/index.js";
import { UpdateAvailablePage } from "./update-available/index.js";

function focusOnMount(node: HTMLElement) {
	node.focus();
}

// Create logger for error logging
const logger = createLogger({
	id: LOGGER_IDS.MAIN_PAGE,
	name: "Main Page",
});

// Create selector registry context BEFORE app state so components can use it
// This enables focused panel dispatch for model/mode keybindings
const selectorRegistry = setSelectorRegistryContext();

// Load agent model preferences from SQLite (module-level store)
agentModelPreferencesStore.loadPersistedState();

// Create stores in dependency order (Context Composition pattern)
const agentStore = createAgentStore();
const agentPreferencesStore = createAgentPreferencesStore();
const sessionStore = createSessionStore();
const interactionStore = createInteractionStore();
const sessionProjectionHydrator = new SessionProjectionHydrator(interactionStore);
const sessionDomainEventSubscriber = new SessionDomainEventSubscriber();
const liveInteractionProjectionSync = new LiveInteractionProjectionSync(
	sessionDomainEventSubscriber,
	sessionProjectionHydrator
);
const permissionStore = createPermissionStore(interactionStore);
const questionStore = createQuestionStore(interactionStore);
// QuestionSelectionStore is accessed via getQuestionSelectionStore() context, no direct reference needed
createQuestionSelectionStore();
// QueueStore is accessed via getQueueStore() context, no direct reference needed
createQueueStore();
// MessageQueueStore for per-session message stacking
const messageQueueStore = createMessageQueueStore(sessionStore);
const planStore = createPlanStore();
sessionStore.onSessionRemoved((id) => {
	planStore.clear(id);
	messageQueueStore.removeForSession(id);
	sessionProjectionHydrator.clearSession(id);
});
// UnseenStore tracks panels with unseen agent completions (yellow dot indicator)
const unseenStore = createUnseenStore();
// ConnectionStore is accessed via getConnectionStore() context, no direct reference needed
createConnectionStore();
// Review preference (panel vs fullscreen)
const reviewPreferenceStore = createReviewPreferenceStore();
// Plan preference (inline vs sidebar)
const planPreferenceStore = createPlanPreferenceStore();
// Chat preferences (thinking block collapsed by default, etc.)
const chatPreferencesStore = createChatPreferencesStore();

// Notification popup stores
const windowFocusStore = createWindowFocusStore();
const notificationPrefsStore = createNotificationPreferencesStore();
const dismissedTipsStore = createDismissedTipsStore();
void dismissedTipsStore.initialize();

// Create workspace store first (for persist callback)
let workspaceStore: ReturnType<typeof createWorkspaceStore>;
const panelStore = createPanelStore(sessionStore, agentStore, () => {
	workspaceStore?.persist();
});
workspaceStore = createWorkspaceStore(panelStore, sessionStore);

// Create urgency tabs store for sorted tab display
const urgencyTabsStore = createUrgencyTabsStore(panelStore, sessionStore, interactionStore);

// Create tab bar store for flat, panel-ordered tabs with mode/state/tool indicators
const tabBarStore = createTabBarStore(panelStore, sessionStore, interactionStore, unseenStore);

// Create voice settings store (context for voice-section and agent-input-ui)
const voiceSettingsStore = createVoiceSettingsStore();
const preconnectionAgentSkillsStore = createPreconnectionAgentSkillsStore();

// Wire unseen-clear on panel focus
panelStore.onPanelFocused = (panelId) => {
	unseenStore.markSeen(panelId);
};

// Get connection store (created earlier, now accessible)
const connectionStore = getConnectionStore();

function focusOrOpenSessionPanel(sessionId: string): void {
	const existingPanel = panelStore.getPanelBySessionId(sessionId);
	if (existingPanel) {
		panelStore.focusPanel(existingPanel.id);
		return;
	}

	const openedPanel = panelStore.openSession(sessionId, DEFAULT_PANEL_WIDTH);
	if (openedPanel) {
		panelStore.focusPanel(openedPanel.id);
	}
}

function hydrateInteractionProjection(
	sessionId: string,
	source: string,
	onHydrated?: () => void
): void {
	void sessionProjectionHydrator.hydrateSession(sessionId).match(
		() => {
			onHydrated?.();
		},
		(error) => {
			logger.error("Failed to hydrate interaction projection", {
				sessionId,
				source,
				error,
			});
		}
	);
}

function buildPlanApprovalIdFromQuestion(
	question: QuestionRequest & {
		jsonRpcRequestId: number;
		tool: NonNullable<QuestionRequest["tool"]>;
	}
): string {
	return buildPlanApprovalInteractionId(
		question.sessionId,
		question.tool.callID,
		question.jsonRpcRequestId
	);
}

function isPlanApprovalQuestion(question: QuestionRequest): question is QuestionRequest & {
	jsonRpcRequestId: number;
	tool: NonNullable<QuestionRequest["tool"]>;
} {
	if (question.jsonRpcRequestId === undefined || question.tool === undefined) {
		return false;
	}

	if (question.questions.length !== 1) {
		return false;
	}

	const options = question.questions[0]?.options;
	if (!options || options.length !== 2) {
		return false;
	}

	return options[0]?.label === "Approve" && options[1]?.label === "Reject";
}

function getQuestionNotificationId(question: QuestionRequest): string {
	if (!isPlanApprovalQuestion(question)) {
		return question.id;
	}

	return buildPlanApprovalIdFromQuestion(question);
}

function hasPendingQuestionNotificationTarget(question: QuestionRequest): boolean {
	if (!isPlanApprovalQuestion(question)) {
		return interactionStore.questionsPending.has(question.id);
	}

	const approval = interactionStore.planApprovalsPending.get(
		buildPlanApprovalIdFromQuestion(question)
	);
	return approval?.status === "pending";
}

function collectPendingTurnInputNotificationIds(sessionId: string): Set<string> {
	const staleIds = new Set<string>();
	for (const [id, permission] of interactionStore.permissionsPending) {
		if (permission.sessionId === sessionId) staleIds.add(id);
	}
	for (const [id, question] of interactionStore.questionsPending) {
		if (question.sessionId === sessionId) staleIds.add(id);
	}
	for (const [id, approval] of interactionStore.planApprovalsPending) {
		if (approval.sessionId === sessionId && approval.status === "pending") staleIds.add(id);
	}
	return staleIds;
}

function dismissPendingTurnInputNotifications(sessionId: string): void {
	const staleIds = collectPendingTurnInputNotificationIds(sessionId);
	if (staleIds.size === 0) return;
	dismissWhere((notification) => staleIds.has(notification.id));
}

function clearPendingTurnInputs(sessionId: string): void {
	dismissPendingTurnInputNotifications(sessionId);
	questionStore.removeForSession(sessionId);
	permissionStore.removeForSession(sessionId);
	removePlanApprovalsForSession(sessionId);
}

function cancelPendingTurnInputs(sessionId: string): void {
	dismissPendingTurnInputNotifications(sessionId);
	removePlanApprovalsForSession(sessionId);
	void questionStore.cancelForSession(sessionId).match(
		() => {},
		(error) => {
			logger.error("Failed to cancel pending questions for interrupted turn", {
				sessionId,
				error,
			});
		}
	);
	void permissionStore.cancelForSession(sessionId).match(
		() => {},
		(error) => {
			logger.error("Failed to cancel pending permissions for interrupted turn", {
				sessionId,
				error,
			});
		}
	);
}

function removePlanApprovalsForSession(sessionId: string): void {
	for (const [id, approval] of interactionStore.planApprovalsPending) {
		if (
			approval.sessionId === sessionId &&
			approval.source === "create_plan" &&
			approval.status === "pending"
		) {
			interactionStore.planApprovalsPending.delete(id);
		}
	}
}

// Set up SessionStore callbacks for permission/question/plan routing
sessionStore.setCallbacks({
	onPermissionRequest: (permission) => {
		hydrateInteractionProjection(permission.sessionId, "session-update-permission", () => {
			const currentPermission = permissionStore.getForToolCall(
				permission.sessionId,
				permission.tool?.callID ?? permission.id
			);
			if (!currentPermission || currentPermission.id !== permission.id) {
				return;
			}
			showNotification(
				{
					id: currentPermission.id,
					type: "permission",
					title: currentPermission.permission,
					body: currentPermission.patterns.join(", "),
					actions: PERMISSION_ACTIONS,
					sessionId: currentPermission.sessionId,
					sourceId: currentPermission.id,
				},
				(actionId) => {
					if (!interactionStore.permissionsPending.has(currentPermission.id)) return;
					if (actionId === "allow") {
						permissionStore.reply(currentPermission.id, "once");
					} else if (actionId === "allow-always") {
						permissionStore.reply(currentPermission.id, "always");
					} else if (actionId === "deny") {
						permissionStore.reply(currentPermission.id, "reject");
					} else if (actionId === "view") {
						focusOrOpenSessionPanel(currentPermission.sessionId);
					}
				},
				{
					windowFocused: windowFocusStore.isFocused,
					categoryEnabled: notificationPrefsStore.questionsEnabled,
				}
			);
		});
	},
	onQuestionRequest: (question) => {
		hydrateInteractionProjection(question.sessionId, "session-update-question", () => {
			const notificationId = getQuestionNotificationId(question);
			const questionText =
				question.questions[0]?.question ?? question.questions[0]?.header ?? "Agent question";
			showNotification(
				{
					id: notificationId,
					type: "question",
					title: "Agent Question",
					body: questionText,
					actions: QUESTION_ACTIONS,
					sessionId: question.sessionId,
					sourceId: notificationId,
				},
				(actionId) => {
					if (!hasPendingQuestionNotificationTarget(question)) return;
					if (actionId === "view") {
						focusOrOpenSessionPanel(question.sessionId);
					}
				},
				{
					windowFocused: windowFocusStore.isFocused,
					categoryEnabled: notificationPrefsStore.questionsEnabled,
				}
			);
		});
	},
	onPlanUpdate: (sessionId: string, planData: PlanData) => {
		// Update plan store with streaming content
		planStore.updateFromEvent(sessionId, planData);

		// If plan has no content, fall back to disk-based loading
		if (
			(planData.content === undefined || planData.content === null) &&
			(planData.contentMarkdown === undefined || planData.contentMarkdown === null) &&
			planData.steps.length === 0 &&
			planData.hasPlan !== true &&
			planData.streaming !== true
		) {
			const identity = sessionStore.getSessionIdentity(sessionId);
			if (identity?.projectPath && identity?.agentId) {
				planStore.loadPlan(sessionId, identity.projectPath, identity.agentId);
			}
		}

		// Auto-open sidebar for any normalized plan signal.
		const panel = panelStore.getPanelBySessionId(sessionId);
		if (
			panel &&
			planPreferenceStore.isReady &&
			planStore.shouldAutoOpen(sessionId, planPreferenceStore.preferInline)
		) {
			panelStore.setPlanSidebarExpanded(panel.id, true);
		}
	},
	onTurnComplete: (sessionId: string) => {
		const panel = panelStore.getPanelBySessionId(sessionId);
		if (!panel) return;
		if (panel.id !== panelStore.focusedPanelId) {
			// Mark panel as unseen when agent completes while tab is unfocused
			unseenStore.markUnseen(panel.id);
		} else {
			// Clear any stale unseen state when agent completes while tab IS focused
			unseenStore.markSeen(panel.id);
		}

		// Show completion popup notification when app is unfocused
		const sessionTitle = sessionStore.getSessionCold(sessionId)?.title ?? "Task";
		showNotification(
			{
				id: `completion-${sessionId}-${Date.now()}`,
				type: "completion",
				title: "Task Complete",
				body: sessionTitle,
				actions: COMPLETION_ACTIONS,
				autoDismissMs: 5000,
				sessionId,
			},
			(actionId) => {
				if (actionId === "view") {
					focusOrOpenSessionPanel(sessionId);
				}
			},
			{
				windowFocused: windowFocusStore.isFocused,
				categoryEnabled: notificationPrefsStore.completionsEnabled,
			}
		);

		// Clean up stale pending questions/permissions — if the turn completed,
		// by definition no pending input is needed for this session.
		clearPendingTurnInputs(sessionId);

		// Drain next queued message (if any)
		messageQueueStore.drainNext(sessionId);
	},
	onTurnInterrupted: (sessionId: string) => {
		cancelPendingTurnInputs(sessionId);
	},
	onTurnError: (sessionId: string) => {
		messageQueueStore.pause(sessionId);
		clearPendingTurnInputs(sessionId);
	},
	onPrNumberFound: (sessionId: string, prNumber: number) => {
		void tauriClient.history.setSessionPrNumber(sessionId, prNumber);
	},
});

// Auto-accept permissions from child sessions (subtasks)
permissionStore.setAutoAccept((permission) => {
	const sessionMetadata = sessionStore.getSessionMetadata(permission.sessionId);
	if (sessionMetadata && sessionMetadata.parentId != null) {
		return "child-session";
	}

	const hotState = sessionStore.getHotState(permission.sessionId);
	if (hotState.autonomousEnabled) {
		return "autonomous-live";
	}

	return false;
});

// Initialize session updates subscription
sessionStore.initializeSessionUpdates().mapErr((error) => {
	logger.error("Failed to initialize session updates", { error });
	viewState.initializationError = error instanceof Error ? error : new Error(String(error));
});

// Project manager (separate for now, could be merged later)
const projectManager = new ProjectManager();

// Connect session store to project manager for scan operations on import
projectManager.setSessionStore(sessionStore);

// Set up project color lookup for urgency tabs store and tab bar
// This ensures tabs use actual project colors instead of hash-based fallbacks
const projectColorLookup = (projectPath: string) => {
	const project = projectManager.projects.find((p) => p.path === projectPath);
	return project?.color ?? null;
};
urgencyTabsStore.setProjectColorLookup(projectColorLookup);
tabBarStore.setProjectColorLookup(projectColorLookup);

// Set up project creation date lookup for tab bar group ordering
const projectCreatedAtLookup = (projectPath: string) => {
	const project = projectManager.projects.find((p) => p.path === projectPath);
	return project?.createdAt ?? null;
};
tabBarStore.setProjectCreatedAtLookup(projectCreatedAtLookup);

// Inbound request handler for JSON-RPC requests from ACP subprocess (e.g., requestPermission)
const inboundRequestHandler = new InboundRequestHandler();

// Initialize keybindings service
const kb = getKeybindingsService();

// Worktree default store (single source of truth; load once so handleNewThreadForProject reads current value)
const worktreeDefaultStore = getWorktreeDefaultStore();

// Create main app view state - manages all business logic
const viewState = new MainAppViewState(
	sessionStore,
	panelStore,
	agentStore,
	connectionStore,
	workspaceStore,
	projectManager,
	agentPreferencesStore,
	kb,
	selectorRegistry,
	worktreeDefaultStore,
	preconnectionAgentSkillsStore,
	sessionProjectionHydrator
);

// Add repository dialog (unified import/clone/browse modal)
const projectClient = new ProjectClient();
let addProjectDialogOpen = $state(false);
let startupMaximizeTriggered = false;

function handleAddProjectOpen(path: string, name: string) {
	const project = {
		path,
		name,
		createdAt: new Date(),
		color: "cyan",
	};
	projectManager.addProject(project).match(
		() => {
			sessionStore.scanSessions([path]).mapErr(() => {});
			panelStore.spawnPanel({ projectPath: path });
		},
		(error) => {
			toast.error(`Failed to open project: ${error.message}`);
		}
	);
}

function handleAddProjectImported(path: string, name: string) {
	projectManager.addProjectOptimistic(path, name);
	projectManager.loadProjects().mapErr(() => {});
	sessionStore.scanSessions([path]).mapErr(() => {});
}

async function handleOpenFolder() {
	const result = await projectClient.browseProject();
	result.match(
		(project) => {
			if (project) {
				handleAddProjectOpen(project.path, project.name);
			}
		},
		(error) => {
			toast.error(`Failed to open folder: ${error.message}`);
		}
	);
}

function maximizeWindow(): void {
	if (startupMaximizeTriggered) {
		return;
	}

	startupMaximizeTriggered = true;
	void getCurrentWindow()
		.maximize()
		.catch((error) => {
			startupMaximizeTriggered = false;
			logger.error("Failed to maximize startup window", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
}

function attemptStartupMaximize(): void {
	if (!canMaximizeFromStartupGate(viewState.showSplash, updaterState)) {
		return;
	}

	maximizeWindow();
}

// Update state (for forced auto-updates) - now safe to use $state since we renamed 'state' to 'viewState'
// Start with null - will be set to "checking" when update check runs (only in production)
let appVersion = $state<string | null>(null);
let updaterState = $state<UpdaterBannerState>(createIdleUpdaterState());
let blockAppForUpdate = $state(false);
let availableUpdate = $state<Awaited<ReturnType<typeof check>> | null>(null);
let updatePollTimer = $state<ReturnType<typeof setInterval> | null>(null);
let devUpdateStartTimer = $state<ReturnType<typeof setTimeout> | null>(null);
let devUpdateStepTimer = $state<ReturnType<typeof setInterval> | null>(null);

type UpdateCheckTrigger = "startup" | "polling";

const DEV_UPDATE_VERSION = "0.0.0-dev";
const DEV_UPDATE_TOTAL_BYTES = 48 * 1024 * 1024;
const DEV_UPDATE_STEP_BYTES = 3 * 1024 * 1024;
const DEV_UPDATE_START_DELAY_MS = 700;
const DEV_UPDATE_STEP_DELAY_MS = 180;

function clearDevUpdateSimulation(): void {
	if (devUpdateStartTimer) {
		clearTimeout(devUpdateStartTimer);
		devUpdateStartTimer = null;
	}
	if (devUpdateStepTimer) {
		clearInterval(devUpdateStepTimer);
		devUpdateStepTimer = null;
	}
}

function startDevUpdateSimulation(): void {
	clearDevUpdateSimulation();
	blockAppForUpdate = true;
	updaterState = createCheckingUpdaterState();

	devUpdateStartTimer = setTimeout(() => {
		devUpdateStartTimer = null;
		updaterState = {
			kind: "downloading",
			version: DEV_UPDATE_VERSION,
			downloadedBytes: 0,
			totalBytes: DEV_UPDATE_TOTAL_BYTES,
		};

		devUpdateStepTimer = setInterval(() => {
			if (updaterState.kind !== "downloading") {
				clearDevUpdateSimulation();
				return;
			}

			const nextDownloadedBytes = Math.min(
				updaterState.downloadedBytes + DEV_UPDATE_STEP_BYTES,
				DEV_UPDATE_TOTAL_BYTES
			);

			updaterState = {
				kind: "downloading",
				version: updaterState.version,
				downloadedBytes: nextDownloadedBytes,
				totalBytes: DEV_UPDATE_TOTAL_BYTES,
			};

			if (nextDownloadedBytes >= DEV_UPDATE_TOTAL_BYTES) {
				const timer = devUpdateStepTimer;
				if (timer !== null) {
					clearInterval(timer);
				}
				devUpdateStepTimer = null;
				updaterState = createInstallingUpdaterState(DEV_UPDATE_VERSION);
			}
		}, DEV_UPDATE_STEP_DELAY_MS);
	}, DEV_UPDATE_START_DELAY_MS);
}

// Register urgency jump handler (Cmd+J)
kb.upsertAction({
	id: KEYBINDING_ACTIONS.URGENCY_JUMP_FIRST,
	label: m.keybinding_jump_to_urgent(),
	description: m.keybinding_jump_to_urgent_description(),
	category: "navigation",
	handler: () => {
		const firstTab = urgencyTabsStore.firstTab;
		if (firstTab) {
			panelStore.focusPanel(firstTab.panelId);
			// If in fullscreen mode, switch fullscreen to this panel
			if (panelStore.fullscreenPanelId !== null) {
				panelStore.switchFullscreen(firstTab.panelId);
			}
		}
	},
});

// Initialize advanced command palette with all providers
const commandPalette = useAdvancedCommandPalette({
	sessionStore,
	projectManager,
	panelStore,
	commands: {
		onCreateThread: () => viewState.handleNewThread(),
		onOpenSettings: () => {
			viewState.openSettings();
		},
		onOpenSqlStudio: () => {
			viewState.openSqlStudio();
		},
		onToggleSidebar: () => {
			viewState.sidebarOpen = !viewState.sidebarOpen;
		},
		onToggleTopBar: () => {
			viewState.toggleTopBar();
		},
		onCloseThread: () => {
			const focusedPanelId = panelStore.focusedPanelId;
			if (focusedPanelId) {
				viewState.handleClosePanel(focusedPanelId);
			}
		},
		onToggleDebug: () => {
			viewState.debugPanelOpen = !viewState.debugPanelOpen;
		},
	},
	onOpenSession: (sessionId) => {
		viewState.handleSelectSession(sessionId);
	},
	onOpenFile: (filePath, projectPath) => {
		// Open file in file panel
		panelStore.openFilePanel(filePath, projectPath);
	},
});

async function checkForAppUpdate(trigger: UpdateCheckTrigger): Promise<void> {
	blockAppForUpdate = trigger === "startup";
	updaterState = createCheckingUpdaterState();
	const result = await ResultAsync.fromPromise(check(), (e) => e as Error).match(
		(update) => update,
		(error) => {
			logger.error("Update check failed", { error: error.message });
			updaterState = createErrorUpdaterState(error.message);
			return null;
		}
	);

	if (!result) {
		availableUpdate = null;
		if (updaterState.kind !== "error") {
			updaterState = createIdleUpdaterState();
		}
		if (trigger !== "startup") {
			blockAppForUpdate = false;
		}
		if (updaterState.kind === "idle") {
			blockAppForUpdate = false;
		}
		attemptStartupMaximize();
		return;
	}

	availableUpdate = result;
	logger.info("Update available", { version: result.version });
	if (trigger === "startup") {
		await downloadAndInstallAvailableUpdate();
		return;
	}
	void predownloadAvailableUpdate();
}

async function predownloadAvailableUpdate(): Promise<void> {
	if (!availableUpdate) {
		return;
	}

	blockAppForUpdate = false;
	updaterState = createDownloadingUpdaterState(availableUpdate.version);
	await predownloadUpdate(availableUpdate, (event: DownloadEvent) => {
		updaterState = applyUpdaterDownloadEvent(updaterState, event);
	}).match(
		(version) => {
			logger.info("Update download finished", { version });
			updaterState = createAvailableUpdaterState(version);
		},
		(error) => {
			availableUpdate = null;
			updaterState = createErrorUpdaterState(error.message);
			logger.error("Update download failed", { error: error.message });
		}
	);
}

async function downloadAndInstallAvailableUpdate(): Promise<void> {
	if (!availableUpdate) {
		return;
	}

	const update = availableUpdate;
	updaterState = createDownloadingUpdaterState(update.version);
	await downloadAndInstallUpdate(
		update,
		(event: DownloadEvent) => {
			if (event.event === "Finished") {
				updaterState = createInstallingUpdaterState(update.version);
				return;
			}

			updaterState = applyUpdaterDownloadEvent(updaterState, event);
		},
		relaunch
	).match(
		(version) => {
			logger.info("Startup update installed", { version });
		},
		(error) => {
			availableUpdate = null;
			updaterState = createErrorUpdaterState(error.message);
			logger.error("Startup update install failed", { error: error.message });
		}
	);
}

async function installAvailableUpdate(): Promise<void> {
	if (!availableUpdate) {
		return;
	}

	blockAppForUpdate = false;
	updaterState = createInstallingUpdaterState(availableUpdate.version);
	await installDownloadedUpdate(availableUpdate, relaunch).match(
		() => undefined,
		(error) => {
			availableUpdate = null;
			updaterState = createErrorUpdaterState(error.message);
			logger.error("Update install failed", { error: error.message });
		}
	);
}

// Initialize on mount
onMount(async () => {
	playSound(SoundEffect.AppStart);

	// Preload latency-critical voice sounds so spacebar-triggered
	// recording feedback is instant (Web Audio API buffer cache).
	preloadSound(SoundEffect.DictationStart);
	preloadSound(SoundEffect.DictationStop);
	preloadSound(SoundEffect.Notification);
	const splashResolution = viewState.resolveSplashScreen();
	void import("@tauri-apps/api/app")
		.then((mod) => mod.getVersion())
		.then((version) => {
			appVersion = version;
		});

	if (import.meta.env.DEV) {
		updaterState = createAvailableUpdaterState(DEV_UPDATE_VERSION);
	} else {
		await checkForAppUpdate("startup");
		updatePollTimer = setInterval(
			() => {
				if (
					updaterState.kind === "downloading" ||
					updaterState.kind === "installing" ||
					blockAppForUpdate ||
					availableUpdate !== null
				) {
					return;
				}
				void checkForAppUpdate("polling");
			},
			10 * 60 * 1000
		);
	}

	await splashResolution;
	attemptStartupMaximize();

	logger.info("main-app-view onMount: Starting InboundRequestHandler");
	const liveSyncResult = await liveInteractionProjectionSync.start();
	if (liveSyncResult.isErr()) {
		logger.error("Failed to start live interaction projection sync", {
			error: liveSyncResult.error,
		});
	}

	// Initialize inbound request handler for ACP permission and question requests
	const handlerResult = await inboundRequestHandler.start(
		(permission) => {
			logger.debug("Permission callback invoked", { permissionId: permission.id });
			enrichExistingToolCallFromPermission(sessionStore, permission);
			hydrateInteractionProjection(permission.sessionId, "inbound-permission");
		},
		(question) => {
			logger.debug("Question callback invoked", { questionId: question.id });
			hydrateInteractionProjection(question.sessionId, "inbound-question");
		}
	);
	if (handlerResult.isErr()) {
		logger.error("[Startup] Failed to start inbound request handler:", handlerResult.error);
		viewState.initializationError = handlerResult.error;
	} else {
		logger.info("main-app-view onMount: InboundRequestHandler started successfully");
	}

	// Initialize the app state (handles all initialization logic including background scan)
	const initResult = await viewState.initialize();

	// Initialize review preference (load persisted setting)
	reviewPreferenceStore.initialize();
	planPreferenceStore.initialize();
	chatPreferencesStore.initialize();

	// Initialize notification popup stores
	windowFocusStore.initialize();
	notificationPrefsStore.initialize();

	// Initialize voice settings (loads persisted prefs + model list from backend)
	void voiceSettingsStore.initialize();

	if (initResult.isErr()) {
		logger.error("[Startup] Initialization failed:", initResult.error);
		viewState.initializationError = initResult.error;
	}

	// Register global keyboard handler for CMD+F
	window.addEventListener("keydown", handleGlobalKeydown);
});

// Track threadActive context for keybindings (Cmd+W to close thread)
$effect(() => {
	const hasActiveThread = panelStore.panels.length > 0;
	kb.setContext("threadActive", hasActiveThread);
});

// Track settingsOpen context to suppress app-level keybindings while settings is open
$effect(() => {
	kb.setContext("settingsOpen", viewState.settingsModalOpen);
});

// Track sqlStudioOpen context for global keybinding conditions
$effect(() => {
	kb.setContext("sqlStudioOpen", viewState.sqlStudioModalOpen);
});

// Track modalOpen context so overlay UIs suppress app-level keybindings
$effect(() => {
	kb.setContext(
		"modalOpen",
		viewState.settingsModalOpen ||
			viewState.sqlStudioModalOpen ||
			viewState.reviewFullscreenOpen ||
			viewState.fileExplorerVisible
	);
});

// Load worktree default store once so panels/empty-states/settings and handleNewThreadForProject see current value
$effect(() => {
	void worktreeDefaultStore.load().mapErr((error) => {
		logger.error("Failed to load worktree default preference", { error });
	});
});

function handleSessionCreated(sessionId: string) {
	panelStore.openSession(sessionId, DEFAULT_PANEL_WIDTH);
}

// Handle onboarding completion (splash → agents → projects → done)
function handleOnboardingDismiss() {
	tauriClient.settings.setRaw("has_seen_splash", "true").mapErr((error) => {
		logger.error("Failed to save onboarding completion", { error });
	});

	// Reload projects + session history so sidebar shows imported projects
	projectManager.loadProjects().map(() => {
		const projectPaths = projectManager.projects.map((p) => p.path);
		if (projectPaths.length > 0) {
			sessionStore.loadSessions(projectPaths);
		}
	});
	viewState.dismissSplash();
	attemptStartupMaximize();
}

// CMD+F fullscreen toggle handler
function handleGlobalKeydown(event: KeyboardEvent) {
	// CMD+F (or Ctrl+F on Windows/Linux) - toggle fullscreen on focused panel
	if ((event.metaKey || event.ctrlKey) && event.key === "f") {
		event.preventDefault();
		const focusedPanelId = panelStore.focusedPanelId;
		if (focusedPanelId) {
			viewState.handleToggleFullscreen(focusedPanelId);
		}
	}
}

const fileExplorerFocusContext = $derived.by(() => {
	const focusedPanel = panelStore.focusedTopLevelPanel;
	if (focusedPanel) {
		const focusedWorktreePath = focusedPanel.kind === "agent" ? focusedPanel.worktreePath : null;
		return {
			focusedProjectPath: focusedPanel.projectPath ? focusedPanel.projectPath : null,
			focusedWorktreePath: focusedWorktreePath ? focusedWorktreePath : null,
		};
	}

	return {
		focusedProjectPath: panelStore.focusedViewProjectPath
			? panelStore.focusedViewProjectPath
			: null,
		focusedWorktreePath: null,
	};
});

const fileExplorerProjectPaths = $derived.by(() => {
	return buildFileExplorerProjectPaths(
		projectManager.projects,
		fileExplorerFocusContext.focusedProjectPath,
		fileExplorerFocusContext.focusedWorktreePath
	);
});

const fileExplorerProjectInfoByPath = $derived.by(() => {
	return buildFileExplorerProjectInfoByPath(
		projectManager.projects,
		fileExplorerFocusContext.focusedProjectPath,
		fileExplorerFocusContext.focusedWorktreePath
	);
});

// Derived: check if any panel is open
const hasAnyPanel = $derived(
	panelStore.panels.length > 0 ||
		panelStore.filePanels.length > 0 ||
		panelStore.reviewPanels.length > 0 ||
		panelStore.terminalPanels.length > 0 ||
		panelStore.browserPanels.length > 0
);
const showPanelsContainer = $derived(hasAnyPanel || panelStore.viewMode === "kanban");

// Derived: keep the sidebar mounted whenever projects exist.
// The open state now controls width/content density instead of removing it entirely.
const showSidebar = $derived(
	projectManager.projectCount !== null && projectManager.projectCount > 0
);

/** Tab bar above main/panel column (only shown in session fullscreen when there is something to switch) */
const showTabBarStrip = $derived(
	!viewState.reviewFullscreenOpen &&
		viewState.isFullscreen &&
		tabBarStore.tabs.length > 1 &&
		viewState.topBarVisible
);

// Cleanup on destroy
onDestroy(() => {
	// Disconnect all sessions to kill their subprocesses
	// This prevents orphaned Claude processes when the app closes
	sessionStore.disconnectAllSessions();
	// Cleanup state (handles keybindings uninstall and HMR guard reset)
	viewState.cleanup();
	// Cleanup inbound request handler
	inboundRequestHandler.stop();
	liveInteractionProjectionSync.stop();
	// Cleanup session update subscription (removes Tauri event listener)
	sessionStore.cleanupSessionUpdates();
	// Unregister global keyboard handler
	window.removeEventListener("keydown", handleGlobalKeydown);
	// Cleanup notification system
	windowFocusStore.cleanup();
	// Cleanup voice settings (removes Tauri event listener for download progress)
	voiceSettingsStore.dispose();
	if (updatePollTimer) {
		clearInterval(updatePollTimer);
	}
	clearDevUpdateSimulation();
});
</script>

<ThemeProvider class="overflow-hidden h-dvh bg-background">
	<div class="flex flex-col h-full min-h-0 pt-0.5 pb-0.5 overflow-hidden">
		<!-- Top bar -->
		<div class="shrink-0 overflow-hidden">
			<TopBar
				{viewState}
				updaterState={updaterState}
				onUpdateClick={() => {
					if (getUpdaterPrimaryAction(import.meta.env.DEV, availableUpdate !== null) === "simulate") {
						startDevUpdateSimulation();
						return;
					}
					void installAvailableUpdate();
				}}
				onRetryUpdateClick={() => {
					void checkForAppUpdate("polling");
				}}
				onDevShowUpdatePage={() => {
					startDevUpdateSimulation();
				}}
				onDevShowDesignSystem={() => {
					viewState.designSystemOpen = true;
				}}
			>
				{#snippet addProjectButton()}
					<button
						class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
						title={m.add_repository_button()}
						aria-label={m.add_repository_button()}
						onclick={() => (addProjectDialogOpen = true)}
					>
						<FolderPlus class="size-4" weight="fill" />
					</button>
				{/snippet}
			</TopBar>
		</div>
		{#if !viewState.reviewFullscreenOpen}
			<div class="flex-1 flex min-h-0 gap-0.5 overflow-hidden transition-[padding] duration-200 ease-out">
				{#if showSidebar && viewState.sidebarOpen}
					<div class="shrink-0 flex flex-col h-full min-h-0 transition-[transform,opacity] duration-200 ease-out">
						<AppSidebar {projectManager} state={viewState} />
					</div>
				{/if}
				<main
					class="flex-1 flex min-h-0 flex-col gap-0.5 overflow-hidden transition-[background-color] duration-200 ease-out {showPanelsContainer
						? ''
						: 'justify-center items-center overflow-x-auto'}"
				>
					<!-- Tab bar (project cards + tabs): only above panel column, aligned with main -->
					{#if showTabBarStrip}
						<div class="shrink-0 overflow-hidden">
							<TabBar
								groupedTabs={tabBarStore.groupedTabs}
								onSelectTab={(panelId) => {
									panelStore.focusAndSwitchToPanel(panelId);
								}}
								onCloseTab={(panelId) => viewState.handleClosePanel(panelId)}
							/>
						</div>
					{/if}
					{#if showPanelsContainer}
						<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
							<PanelsContainer {projectManager} state={viewState} />
						</div>
					{:else if viewState.initializationComplete}
						<EmptyStates {projectManager} onSessionCreated={handleSessionCreated} />
					{/if}
				</main>
			</div>
		{/if}
	</div>
	<AppOverlays state={viewState} {commandPalette} />
	<SourceControlDialog {projectManager} />
	<DesignSystemShowcase
		open={viewState.designSystemOpen}
		onOpenChange={(open) => {
			viewState.designSystemOpen = open;
		}}
	/>

	<OpenProjectDialog
		open={addProjectDialogOpen}
		onOpenChange={(open) => (addProjectDialogOpen = open)}
		onProjectImported={handleAddProjectImported}
		onCloneComplete={handleAddProjectOpen}
		onBrowseFolder={handleOpenFolder}
	/>

	{#if $gitHubDiffViewerStore.opened && $gitHubDiffViewerStore.reference}
		<DiffViewerModal
			open={$gitHubDiffViewerStore.opened}
			reference={$gitHubDiffViewerStore.reference}
			projectPath={$gitHubDiffViewerStore.projectPath ?? undefined}
			onClose={() => gitHubDiffViewerStore.close()}
		/>
	{/if}

	<!-- Database Manager Modal -->
	{#if viewState.sqlStudioModalOpen}
		<div
			class="fixed inset-0 z-[var(--app-modal-z)] flex items-center justify-center bg-black/55 p-2 sm:p-4 md:p-5"
			role="dialog"
			aria-modal="true"
			aria-label="Database Manager"
			tabindex="-1"
			use:focusOnMount
			onclick={(event) => {
				if (event.target === event.currentTarget) {
					viewState.closeSqlStudio();
				}
			}}
			onkeydown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					viewState.closeSqlStudio();
				}
			}}
		>
			<div
				class="mx-auto h-full max-h-[820px] w-full max-w-[1180px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
			>
				<SqlStudioPage onClose={() => viewState.closeSqlStudio()} />
			</div>
		</div>
	{/if}

	<!-- Full-screen Review Overlay (kept alive when hidden to preserve hunk decisions) -->
	{#if viewState.reviewFullscreenSessionId}
		{#key viewState.reviewFullscreenSessionId}
			<div
				class="fixed inset-0 z-[var(--app-modal-z)] bg-background"
				role="dialog"
				aria-modal={viewState.reviewFullscreenOpen ? "true" : undefined}
				aria-label="Review changes"
				tabindex="-1"
				aria-hidden={!viewState.reviewFullscreenOpen}
				style:display={viewState.reviewFullscreenOpen ? undefined : "none"}
				onkeydown={(e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						viewState.closeReviewFullscreen();
					}
				}}
			>
				<ReviewFullscreenPage
					sessionId={viewState.reviewFullscreenSessionId}
					fileIndex={viewState.reviewFullscreenFileIndex}
					onClose={() => viewState.closeReviewFullscreen()}
					onFileIndexChange={(index) => viewState.setReviewFullscreenFileIndex(index)}
				/>
			</div>
		{/key}
	{/if}

	<!-- Settings Modal -->
	{#if viewState.settingsModalOpen}
		<div
			class="fixed inset-0 z-[var(--app-modal-z)] flex items-center justify-center bg-black/55 p-2 sm:p-4 md:p-5"
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
			tabindex="-1"
			use:focusOnMount
			onclick={(event) => {
				if (event.target === event.currentTarget) {
					viewState.closeSettings();
				}
			}}
			onkeydown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					viewState.closeSettings();
				}
			}}
		>
			<div
				class="h-[min(656px,calc(100vh-1rem))] w-full max-w-[944px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_30px_80px_rgba(0,0,0,0.5)] sm:h-[min(656px,calc(100vh-2rem))] md:h-[min(656px,calc(100vh-2.5rem))]"
			>
				<SettingsPage {projectManager} onClose={() => viewState.closeSettings()} />
			</div>
		</div>
	{/if}

	<!-- File Explorer Modal (Cmd+I) -->
	{#if viewState.fileExplorerVisible && fileExplorerProjectPaths.length > 0}
		<FileExplorerModal
			projectPaths={fileExplorerProjectPaths}
			projectInfoByPath={fileExplorerProjectInfoByPath}
			onClose={() => viewState.closeFileExplorer()}
			onInsert={(projectPath, filePath) => {
				panelStore.openFilePanel(filePath, projectPath);
				viewState.closeFileExplorer();
			}}
		/>
	{/if}

	<!-- Onboarding Overlay (shows on first launch: splash → agents → projects → done) -->
	{#if viewState.showSplash === true}
		<div
			class="fixed inset-0 z-[var(--app-blocking-z)]"
			role="dialog"
			aria-modal="true"
			aria-label="Welcome to Acepe"
		>
			<WelcomeScreen
				onProjectImported={(path, name) => {
					projectManager.addProjectOptimistic(path, name);
				}}
				onDismiss={handleOnboardingDismiss}
			/>
		</div>
	{/if}

	<!-- Blocking startup update overlay (startup and dev simulation only) -->
	{#if blockAppForUpdate && shouldShowBlockingUpdaterOverlay(updaterState)}
		<div
			class="fixed inset-0 z-[var(--app-elevated-z)]"
			role="dialog"
			aria-modal="true"
			aria-label={updaterState.kind === "checking"
				? m.update_checking()
				: updaterState.kind === "installing"
					? m.update_installing()
				: updaterState.kind === "error"
					? m.update_error()
					: m.update_downloading()}
		>
			<UpdateAvailablePage
				updaterState={updaterState}
				onRetry={() => {
					if (import.meta.env.DEV) {
						startDevUpdateSimulation();
						return;
					}
					void checkForAppUpdate("startup");
				}}
				onDismiss={import.meta.env.DEV ? () => {
					clearDevUpdateSimulation();
					blockAppForUpdate = false;
					updaterState = createAvailableUpdaterState(DEV_UPDATE_VERSION);
					attemptStartupMaximize();
				} : undefined}
			/>
		</div>
	{/if}

	<!-- Changelog Modal (shows after app updates) -->
	{#if viewState.changelogEntries.length > 0}
		<ChangelogModal
			entries={viewState.changelogEntries}
			onDismiss={() => viewState.dismissChangelog()}
		/>
	{/if}

</ThemeProvider>
