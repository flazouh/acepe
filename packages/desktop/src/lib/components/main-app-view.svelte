<script lang="ts">
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { okAsync, ResultAsync } from "neverthrow";
import FolderPlus from "phosphor-svelte/lib/FolderPlus";
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
import { setSelectorRegistryContext } from "$lib/acp/logic/selector-registry.svelte.js";
import {
	agentModelPreferencesStore,
	createAgentPreferencesStore,
	createAgentStore,
	createChatPreferencesStore,
	createConnectionStore,
	createMessageQueueStore,
	createPanelStore,
	createPermissionStore,
	createPlanPreferenceStore,
	createPlanStore,
	createQuestionStore,
	createQueueStore,
	createReviewPreferenceStore,
	createSessionStore,
	createTabBarStore,
	createUnseenStore,
	createUrgencyTabsStore,
	createWorkspaceStore,
	getConnectionStore,
	gitHubDiffViewerStore,
} from "$lib/acp/store/index.js";
import { createQuestionSelectionStore } from "$lib/acp/store/question-selection-store.svelte.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { ThemeProvider } from "$lib/components/theme/index.js";
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
import AppSidebar from "./main-app-view/components/sidebar/app-sidebar.svelte";
import { MainAppViewState } from "./main-app-view/logic/main-app-view-state.svelte.js";
import { applyDownloadEventToProgress } from "./main-app-view/logic/update-download-progress.js";
import {
	applyUpdaterDownloadEvent,
	createAvailableUpdaterState,
	createCheckingUpdaterState,
	createErrorUpdaterState,
	createIdleUpdaterState,
	createDownloadingUpdaterState,
	type UpdaterBannerState,
} from "./main-app-view/logic/updater-state.js";
import { getQuestionToolCallBackfill } from "./main-app-view/question-tool-sync.js";
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
const permissionStore = createPermissionStore();
const questionStore = createQuestionStore();
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

// Create workspace store first (for persist callback)
let workspaceStore: ReturnType<typeof createWorkspaceStore>;
const panelStore = createPanelStore(sessionStore, agentStore, () => {
	workspaceStore?.persist();
});
workspaceStore = createWorkspaceStore(panelStore, sessionStore);

// Create urgency tabs store for sorted tab display
const urgencyTabsStore = createUrgencyTabsStore(panelStore, sessionStore, questionStore);

// Create tab bar store for flat, panel-ordered tabs with mode/state/tool indicators
const tabBarStore = createTabBarStore(
	panelStore,
	sessionStore,
	questionStore,
	permissionStore,
	unseenStore
);

// Create voice settings store (context for voice-section and agent-input-ui)
const voiceSettingsStore = createVoiceSettingsStore();
const preconnectionAgentSkillsStore = createPreconnectionAgentSkillsStore();

// Wire unseen-clear on panel focus
panelStore.onPanelFocused = (panelId) => {
	unseenStore.markSeen(panelId);
};

// Get connection store (created earlier, now accessible)
const connectionStore = getConnectionStore();

function registerQuestion(question: QuestionRequest): void {
	const backfill = getQuestionToolCallBackfill(
		question,
		sessionStore.getEntries(question.sessionId)
	);
	if (backfill) {
		sessionStore.createToolCallEntry(question.sessionId, backfill);
	}
	questionStore.add(question);
}

// Set up SessionStore callbacks for permission/question/plan routing
sessionStore.setCallbacks({
	onPermissionRequest: (permission) => {
		permissionStore.add(permission);

		// Show popup notification when app is unfocused
		showNotification(
			{
				id: permission.id,
				type: "permission",
				title: permission.permission,
				body: permission.patterns.join(", "),
				actions: PERMISSION_ACTIONS,
				sessionId: permission.sessionId,
				sourceId: permission.id,
			},
			(actionId) => {
				if (!permissionStore.pending.has(permission.id)) return; // stale
				if (actionId === "allow") {
					permissionStore.reply(permission.id, "once");
				} else if (actionId === "allow-always") {
					permissionStore.reply(permission.id, "always");
				} else if (actionId === "deny") {
					permissionStore.reply(permission.id, "reject");
				} else if (actionId === "view") {
					const panel = panelStore.getPanelBySessionId(permission.sessionId);
					if (panel) panelStore.focusPanel(panel.id);
				}
			},
			{
				windowFocused: windowFocusStore.isFocused,
				categoryEnabled: notificationPrefsStore.questionsEnabled,
			}
		);
	},
	onQuestionRequest: (question) => {
		registerQuestion(question);

		// Show popup notification when app is unfocused
		const questionText =
			question.questions[0]?.question ?? question.questions[0]?.header ?? "Agent question";
		showNotification(
			{
				id: question.id,
				type: "question",
				title: "Agent Question",
				body: questionText,
				actions: QUESTION_ACTIONS,
				sessionId: question.sessionId,
				sourceId: question.id,
			},
			(actionId) => {
				if (!questionStore.pending.has(question.id)) return; // stale
				if (actionId === "view") {
					const panel = panelStore.getPanelBySessionId(question.sessionId);
					if (panel) panelStore.focusPanel(panel.id);
				}
			},
			{
				windowFocused: windowFocusStore.isFocused,
				categoryEnabled: notificationPrefsStore.questionsEnabled,
			}
		);
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
					panelStore.focusPanel(panel.id);
				}
			},
			{
				windowFocused: windowFocusStore.isFocused,
				categoryEnabled: notificationPrefsStore.completionsEnabled,
			}
		);

		// Dismiss stale notification popups for this session's permissions/questions
		// Must happen before removeForSession() which clears the store entries
		const staleIds = new Set<string>();
		for (const [id, p] of permissionStore.pending) {
			if (p.sessionId === sessionId) staleIds.add(id);
		}
		for (const [id, q] of questionStore.pending) {
			if (q.sessionId === sessionId) staleIds.add(id);
		}
		if (staleIds.size > 0) {
			dismissWhere((notif) => staleIds.has(notif.id));
		}

		// Clean up stale pending questions/permissions — if the turn completed,
		// by definition no pending input is needed for this session.
		questionStore.removeForSession(sessionId);
		permissionStore.removeForSession(sessionId);

		// Drain next queued message (if any)
		messageQueueStore.drainNext(sessionId);
	},
	onTurnError: (sessionId: string) => {
		messageQueueStore.pause(sessionId);
	},
	onPrNumberFound: (sessionId: string, prNumber: number) => {
		void tauriClient.history.setSessionPrNumber(sessionId, prNumber);
	},
});

// Auto-accept permissions from child sessions (subtasks)
permissionStore.setAutoAccept(
	(permission) => sessionStore.getSessionMetadata(permission.sessionId)?.parentId != null
);

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
	preconnectionAgentSkillsStore
);

// Add repository dialog (unified import/clone/browse modal)
const projectClient = new ProjectClient();
let addProjectDialogOpen = $state(false);

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

// Update state (for forced auto-updates) - now safe to use $state since we renamed 'state' to 'viewState'
// Start with null - will be set to "checking" when update check runs (only in production)
let appVersion = $state<string | null>(null);
let updaterState = $state<UpdaterBannerState>(createIdleUpdaterState());
let showUpdateAvailable = $state(false);
let availableUpdate = $state<Awaited<ReturnType<typeof check>> | null>(null);
let updatePollTimer = $state<ReturnType<typeof setInterval> | null>(null);
let devUpdateStartTimer = $state<ReturnType<typeof setTimeout> | null>(null);
let devUpdateStepTimer = $state<ReturnType<typeof setInterval> | null>(null);

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
	showUpdateAvailable = true;
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
				clearInterval(devUpdateStepTimer);
				devUpdateStepTimer = null;
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

async function checkForAppUpdate(): Promise<void> {
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
			showUpdateAvailable = false;
		}
		playSound(SoundEffect.AppStartFinish);
		return;
	}

	availableUpdate = result;
	logger.info("Update available", { version: result.version });
	updaterState = createAvailableUpdaterState(result.version);
	showUpdateAvailable = true;
	void installAvailableUpdate();
}

async function installAvailableUpdate(): Promise<void> {
	if (!availableUpdate) {
		return;
	}

	updaterState = createDownloadingUpdaterState(availableUpdate.version);
	await ResultAsync.fromPromise(
		availableUpdate.downloadAndInstall((event: DownloadEvent) => {
			updaterState = applyUpdaterDownloadEvent(updaterState, event);
			if (event.event === "Finished") {
				logger.info("Download finished, relaunching...");
			}
		}),
		(e) => e as Error
	)
		.andThen(() => ResultAsync.fromPromise(relaunch(), (e) => e as Error))
		.match(
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
	void import("@tauri-apps/api/app")
		.then((mod) => mod.getVersion())
		.then((version) => {
			appVersion = version;
		});

	if (import.meta.env.DEV) {
		updaterState = createAvailableUpdaterState(DEV_UPDATE_VERSION);
		playSound(SoundEffect.AppStartFinish);
	} else {
		await checkForAppUpdate();
		updatePollTimer = setInterval(() => {
			if (updaterState.kind === "downloading" || showUpdateAvailable) {
				return;
			}
			void checkForAppUpdate();
		}, 10 * 60 * 1000);
	}

	logger.info("main-app-view onMount: Starting InboundRequestHandler");
	// Initialize inbound request handler for ACP permission and question requests
	const handlerResult = await inboundRequestHandler.start(
		(permission) => {
			logger.debug("Permission callback invoked", { permissionId: permission.id });
			permissionStore.add(permission);
		},
		(question) => {
			logger.debug("Question callback invoked", { questionId: question.id });
			registerQuestion(question);
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

const fileExplorerProjectPaths = $derived.by(() => {
	const focusedProjectPath = panelStore.focusedPanel && panelStore.focusedPanel.projectPath
		? panelStore.focusedPanel.projectPath
		: panelStore.focusedViewProjectPath
			? panelStore.focusedViewProjectPath
			: null;

	const remainingProjects = projectManager.projects
		.map((project) => project.path)
		.filter((projectPath) => (focusedProjectPath ? projectPath !== focusedProjectPath : true));

	if (focusedProjectPath) {
		return [focusedProjectPath, ...remainingProjects];
	}

	return remainingProjects;
});

const fileExplorerProjectInfoByPath = $derived.by(() => {
	const info: Record<string, { name: string; color: string }> = {};
	for (const project of projectManager.projects) {
		info[project.path] = {
			name: project.name,
			color: project.color,
		};
	}
	return info;
});

// Derived: check if any panel is open
const hasAnyPanel = $derived(
	panelStore.panels.length > 0 ||
		panelStore.filePanels.length > 0 ||
		panelStore.reviewPanels.length > 0 ||
		panelStore.terminalPanels.length > 0 ||
		panelStore.gitPanels.length > 0 ||
		panelStore.browserPanels.length > 0
);

// Derived: keep the sidebar mounted whenever projects exist.
// The open state now controls width/content density instead of removing it entirely.
const showSidebar = $derived(projectManager.projectCount !== null && projectManager.projectCount > 0);

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

<ThemeProvider class="bg-primary p-1 overflow-hidden h-dvh">
	<div class="flex flex-col h-full min-h-0 gap-0.5 bg-background rounded-xl p-0.5">
		<!-- Top bar -->
		<div class="shrink-0 bg-card/50 border border-border rounded-lg overflow-hidden">
			<TopBar
				{viewState}
				updaterState={updaterState}
				onUpdateClick={() => {
					void installAvailableUpdate();
				}}
				onRetryUpdateClick={() => {
					void checkForAppUpdate();
				}}
				onDevShowUpdatePage={() => {
					startDevUpdateSimulation();
				}}
			>
				{#snippet addProjectButton()}
					<EmbeddedIconButton
						title={m.add_repository_button()}
						ariaLabel={m.add_repository_button()}
						onclick={() => (addProjectDialogOpen = true)}
					>
						<FolderPlus class="size-4" weight="fill" />
					</EmbeddedIconButton>
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
					class="flex-1 flex min-h-0 flex-col gap-0.5 overflow-hidden rounded-lg transition-[border-radius,background-color] duration-200 ease-out {hasAnyPanel
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
					{#if hasAnyPanel}
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
			class="fixed inset-0 z-[9997] flex items-center justify-center bg-black/55 p-2 sm:p-4 md:p-5"
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
				class="fixed inset-0 z-[9997] bg-background"
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
			class="fixed inset-0 z-[9997] flex items-center justify-center bg-black/55 p-2 sm:p-4 md:p-5"
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
			class="fixed inset-0 z-[9999]"
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

	<!-- Auto-update overlay (shows during checking, downloading, error) -->
	{#if showUpdateAvailable && updaterState.kind !== "idle"}
		<div
			class="fixed inset-0 z-[9998]"
			role="dialog"
			aria-modal="true"
			aria-label={m.update_downloading()}
		>
			<UpdateAvailablePage
				updaterState={updaterState}
				onRetry={() => {
					if (import.meta.env.DEV) {
						startDevUpdateSimulation();
						return;
					}
					void checkForAppUpdate();
				}}
				onDismiss={import.meta.env.DEV ? () => {
					clearDevUpdateSimulation();
					showUpdateAvailable = false;
					updaterState = createAvailableUpdaterState(DEV_UPDATE_VERSION);
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
