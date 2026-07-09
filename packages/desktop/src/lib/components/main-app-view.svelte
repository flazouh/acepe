<script lang="ts">
import { Button } from "@acepe/ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { okAsync, ResultAsync } from "neverthrow";
import { onDestroy, onMount, tick } from "svelte";
import { toast } from "svelte-sonner";
import OpenProjectDialog from "$lib/acp/components/add-repository/open-project-dialog.svelte";
import DiffViewerModal from "$lib/acp/components/diff-viewer/diff-viewer-modal.svelte";
import { TabBar } from "$lib/acp/components/tab-bar/index.js";
import { WelcomeScreen } from "$lib/acp/components/welcome-screen/index.js";
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree/worktree-default-store.svelte.js";
import { LOGGER_IDS } from "$lib/acp/constants/logger-ids.js";
import { useAdvancedCommandPalette } from "$lib/acp/hooks/use-advanced-command-palette.svelte.js";
import { InboundRequestHandler } from "$lib/acp/logic/inbound-request-handler.js";
import { ProjectClient } from "$lib/acp/logic/project-client.js";
import {
	ProjectManager,
	type ProjectLoadPerformanceTrace,
} from "$lib/acp/logic/project-manager.svelte.js";
import { setSelectorRegistryContext } from "$lib/acp/logic/selector-registry.svelte.js";
import {
	agentModelPreferencesStore,
	createAgentPreferencesStore,
	createAgentStore,
	createChatPreferencesStore,
	createConnectionStore,
	createInteractionStore,
	createSessionMessageQueueStore,
	createPanelStore,
	createPermissionStore,
	createPlanPreferenceStore,
	createPlanStore,
	createQuestionStore,
	createQueueStore,
	createReviewPreferenceStore,
	createSessionStore,
	SessionOpenHydrator,
	createTabBarStore,
	createUnseenStore,
	createUrgencyTabsStore,
	createWorkspaceStore,
	getConnectionStore,
	gitHubDiffViewerStore,
} from "$lib/acp/store/index.js";
import type { PanelClosePerformanceTrace } from "$lib/acp/store/panel-store.svelte.js";
import type { OpenFilePanelOptions } from "$lib/acp/store/file-panel-ownership.js";
import type { ProjectFileSystemDialogState } from "$lib/acp/store/project-file-system-dialog-state.js";
import { createQuestionSelectionStore } from "$lib/acp/store/question-selection-store.svelte.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import type { PlanApprovalInteraction } from "$lib/acp/types/interaction.js";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { ThemeProvider } from "$lib/components/theme/index.js";
import DesignSystemPage from "$lib/components/dev/design-system-page.svelte";
import { KEYBINDING_ACTIONS } from "$lib/keybindings/constants.js";
import { getKeybindingsService } from "$lib/keybindings/index.js";
import {
	COMPLETION_ACTIONS,
	dismissWhere,
	PERMISSION_ACTIONS,
	QUESTION_ACTIONS,
	showNotification,
} from "$lib/notifications/notification-state.js";
import type { PlanData } from "$lib/services/converted-session-types.js";
import { createPreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";
import { createAnalyticsPreferencesStore } from "$lib/stores/analytics-preferences-store.svelte.js";
import { createAttentionQueueStore } from "$lib/stores/attention-queue-store.svelte.js";
import { createDismissedTipsStore } from "$lib/stores/dismissed-tips-store.svelte.js";
import { createNotificationPreferencesStore } from "$lib/stores/notification-preferences-store.svelte.js";
import { createVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";
import { createWindowFocusStore } from "$lib/stores/window-focus-store.svelte.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import {
	getPendingTauriInvokes,
	getTauriInvokeTimings,
	type TauriInvokeTimingRecord,
} from "$lib/utils/tauri-client/invoke.js";
import { playSound, preloadSound } from "$lib/acp/utils/sound.js";
import { SoundEffect } from "$lib/acp/types/sounds.js";
import { FileExplorerModal } from "$lib/acp/components/file-explorer-modal/index.js";
import ProjectFileSystemDialog from "$lib/acp/components/file-explorer-modal/project-file-system-dialog.svelte";
import EmptyStates from "./main-app-view/components/content/empty-states.svelte";
import PanelsContainer from "./main-app-view/components/content/panels-container.svelte";
import AppOverlays from "./main-app-view/components/overlays/app-overlays.svelte";
import NewChatDialog from "./main-app-view/components/new-chat-dialog.svelte";
import type { KanbanNewSessionRequest } from "./main-app-view/components/content/kanban-new-session-dialog-state.js";
import SourceControlDialog from "./main-app-view/components/overlays/source-control-dialog.svelte";
import AppSidebar from "./main-app-view/components/sidebar/app-sidebar.svelte";
import {
	acknowledgeExplicitPanelReveal,
	applyCompletionAttentionAction,
	performExplicitPanelReveal,
} from "./main-app-view/logic/completion-acknowledgement.js";
import {
	buildFileExplorerProjectInfoByPath,
	buildFileExplorerProjectPaths,
} from "./main-app-view/logic/file-explorer-context.js";
import {
	runSessionOpenContentProbe,
	type SessionOpenContentProbeOptions,
	type SessionOpenContentProbeResult,
} from "./main-app-view/logic/session-open-content-probe.js";
import {
	resolveWorkspaceFrameClass,
	resolveWorkspaceSidebarClass,
} from "./main-app-view/logic/main-app-layout-classes.js";
import { shouldDisconnectSessionsOnMainAppDestroy } from "./main-app-view/logic/main-app-destroy-policy.js";
import { MainAppViewState } from "./main-app-view/logic/main-app-view-state.svelte.js";
import {
	type StartupPerformanceTraceEntry,
	writeSplashSeenHotCache,
} from "./main-app-view/logic/managers/initialization-manager.js";
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
	type UpdaterBannerState,
} from "./main-app-view/logic/updater-state.js";
import {
	installDownloadedUpdate,
	predownloadUpdate,
} from "./main-app-view/logic/updater-workflow.js";
import { ReviewFullscreenPage } from "./review-fullscreen/index.js";
import { SettingsPage } from "./settings-page/index.js";
import SqlStudioPage from "./sql-studio/sql-studio-page.svelte";
import { TopBar } from "./top-bar/index.js";
import {
	createLiveInteractionGraphConsumer,
	createSessionOpenInteractionGraphConsumer,
} from "./main-app-view/logic/live-interaction-graph-consumer.js";

declare global {
	interface Window {
		__acepeOpenStreamingReproLab?: () => boolean;
		__acepeHappyPathProbe?: (
			options?: MainAppHappyPathProbeOptions
		) => Promise<MainAppHappyPathProbeResult>;
		__acepeSessionOpenContentProbe?: (
			options: SessionOpenContentProbeOptions
		) => Promise<SessionOpenContentProbeResult>;
		__acepeCleanupHappyPathProbePanels?: (
			options?: MainAppHappyPathProbeCleanupOptions
		) => MainAppHappyPathProbeCleanupResult;
		__acepeRuntimeErrors?: AcepeRuntimeErrorRecord[];
	}
}

const HAPPY_PATH_PROBE_PANEL_ID_PREFIX = "qa-happy-path-probe-";

type MainAppHappyPathProbeOptions = {
	readonly timeoutMs?: number;
};

type MainAppHappyPathProbeCleanupOptions = {
	readonly closeSessionlessCandidates?: boolean;
};

type MainAppHappyPathProbeCleanupResult = {
	readonly closedPanelIds: readonly string[];
	readonly remainingPanelCount: number;
	readonly remainingDomPanelCount: number;
};

type AcepeRuntimeErrorRecord = {
	readonly type?: string;
	readonly message?: string;
	readonly source?: string | null;
	readonly line?: number | null;
	readonly column?: number | null;
	readonly stack?: string | null;
};

type MainAppHappyPathNavigationTiming = {
	readonly type: string | null;
	readonly startTimeMs: number | null;
	readonly domInteractiveMs: number | null;
	readonly domContentLoadedMs: number | null;
	readonly loadEventEndMs: number | null;
	readonly durationMs: number | null;
};

type MainAppHappyPathAppTiming = {
	readonly mountStartedAtMs: number | null;
	readonly shellReadyAtMs: number | null;
	readonly shellReadyDurationMs: number | null;
	readonly shellReady: boolean;
	readonly shellReadyWaitMs: number | null;
	readonly initializationCompleteAtMs: number | null;
	readonly initializationDurationMs: number | null;
	readonly initializationComplete: boolean;
	readonly initializationWaitMs: number | null;
	readonly projectReady: boolean;
	readonly projectReadyWaitMs: number | null;
	readonly projectCountAtPanelCreate: number;
	readonly startupTrace: readonly StartupPerformanceTraceEntry[];
	readonly projectLoadTrace: ProjectLoadPerformanceTrace | null;
	readonly tauriInvokeTimings: readonly TauriInvokeTimingRecord[];
	readonly panelCountBefore: number;
	readonly panelCountAfter: number;
	readonly domPanelCountBefore: number;
	readonly domPanelCountAfter: number;
};

type MainAppHappyPathTimingEnvironment = {
	readonly visibilityState: string;
	readonly documentHasFocus: boolean | null;
	readonly requestAnimationFrameAvailable: boolean;
	readonly frameWaitCount: number;
	readonly frameFallbackCount: number;
	readonly likelyThrottled: boolean;
	readonly label: string;
};

type MainAppHappyPathProbeFrameStats = {
	frameWaitCount: number;
	frameFallbackCount: number;
};

type MainAppHappyPathPanelOpenMarkSummary = {
	readonly panelFirstMarkMs: number | null;
	readonly panelLastMarkMs: number | null;
	readonly panelMarkedWorkMs: number | null;
	readonly panelPreMarkDelayMs: number | null;
	readonly panelDomReadyAfterLastMarkMs: number | null;
	readonly composerReadyAfterLastMarkMs: number | null;
};

type MainAppHappyPathOpenCloseTiming = {
	readonly panelId: string;
	readonly projectPath: string | null;
	readonly panelOpenMarks: Readonly<Record<string, number>>;
	readonly panelFirstMarkMs: number | null;
	readonly panelLastMarkMs: number | null;
	readonly panelMarkedWorkMs: number | null;
	readonly panelPreMarkDelayMs: number | null;
	readonly panelDomReadyAfterLastMarkMs: number | null;
	readonly composerReadyAfterLastMarkMs: number | null;
	readonly panelCreateMs: number;
	readonly panelDomPresentAfterCreate: boolean;
	readonly panelDomMutationMs: number | null;
	readonly panelDomAfterDomFlushMs: number | null;
	readonly panelDomAfterFirstFrameMs: number | null;
	readonly panelDomReadyMs: number | null;
	readonly composerMutationMs: number | null;
	readonly composerReadyMs: number | null;
	readonly composerReadyAfterCreateMs: number | null;
	readonly panelDomNodeCount: number;
	readonly panelRowNodeCount: number;
	readonly panelDropdownContentNodeCount: number;
	readonly resizeObserverConstructCount: number | null;
	readonly resizeObserverObserveCount: number | null;
	readonly resizeObserverCallbackCount: number | null;
	readonly closeCallReturnMs: number;
	readonly closeMicrotaskMs: number;
	readonly closeDomGoneAfterMicrotask: boolean;
	readonly closeFirstFrameMs: number | null;
	readonly closeDomGoneAfterFirstFrame: boolean;
	readonly closeDomGoneMs: number | null;
	readonly closeTrace: PanelClosePerformanceTrace | null;
	readonly totalMs: number;
};

type MainAppHappyPathProbeResult = {
	readonly hookAvailable: boolean;
	readonly route: string;
	readonly runtimeErrors: readonly string[];
	readonly timingEnvironment: MainAppHappyPathTimingEnvironment;
	readonly navigation: MainAppHappyPathNavigationTiming;
	readonly app: MainAppHappyPathAppTiming;
	readonly openClose: MainAppHappyPathOpenCloseTiming;
};

function focusOnMount(node: HTMLElement) {
	node.focus();
}

function handleContextMenu(event: MouseEvent) {
	if (!import.meta.env.PROD) {
		return;
	}

	if (event.defaultPrevented) {
		return;
	}

	event.preventDefault();
}

// Create logger for error logging
const logger = createLogger({
	id: LOGGER_IDS.MAIN_PAGE,
	name: "Main Page",
});

let mainAppMountStartedAtMs: number | null = null;
let mainAppInitializationCompleteAtMs: number | null = null;
let mainAppInvokeTimingBaselineIndex = 0;
const happyPathProbePanelIds = new Set<string>();
const NON_CRITICAL_STARTUP_WORK_DELAY_MS = 5_000;
const NON_CRITICAL_STARTUP_WORK_TIMEOUT_MS = 5_000;

function roundPerfMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function scheduleNonCriticalStartupWork(callback: () => void): void {
	window.setTimeout(() => {
		const schedulingWindow = window as Window & {
			requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
		};
		if (typeof schedulingWindow.requestIdleCallback === "function") {
			schedulingWindow.requestIdleCallback(callback, {
				timeout: NON_CRITICAL_STARTUP_WORK_TIMEOUT_MS,
			});
			return;
		}
		window.setTimeout(callback, 0);
	}, NON_CRITICAL_STARTUP_WORK_DELAY_MS);
}

function readMainAppNavigationTiming(): MainAppHappyPathNavigationTiming {
	const entries = performance.getEntriesByType("navigation");
	const firstEntry = entries[0];
	if (
		firstEntry !== undefined &&
		typeof PerformanceNavigationTiming !== "undefined" &&
		firstEntry instanceof PerformanceNavigationTiming
	) {
		return {
			type: firstEntry.type,
			startTimeMs: roundPerfMs(firstEntry.startTime),
			domInteractiveMs: roundPerfMs(firstEntry.domInteractive),
			domContentLoadedMs: roundPerfMs(firstEntry.domContentLoadedEventEnd),
			loadEventEndMs: roundPerfMs(firstEntry.loadEventEnd),
			durationMs: roundPerfMs(firstEntry.duration),
		};
	}

	return {
		type: null,
		startTimeMs: null,
		domInteractiveMs: null,
		domContentLoadedMs: null,
		loadEventEndMs: null,
		durationMs: null,
	};
}

function readRuntimeErrorMessages(): readonly string[] {
	const records = window.__acepeRuntimeErrors;
	if (!Array.isArray(records)) {
		return [];
	}
	return records
		.map((record) => record.message ?? record.type ?? "Unknown runtime error")
		.slice(-10);
}

function readCurrentMountTauriInvokeTimings(): readonly TauriInvokeTimingRecord[] {
	return getTauriInvokeTimings().slice(mainAppInvokeTimingBaselineIndex);
}

function waitForProbeFrame(frameStats?: MainAppHappyPathProbeFrameStats): Promise<void> {
	if (frameStats) {
		frameStats.frameWaitCount += 1;
	}
	return new Promise((resolve) => {
		let settled = false;
		const fallbackTimeout = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			if (frameStats) {
				frameStats.frameFallbackCount += 1;
			}
			resolve();
		}, 16);
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(fallbackTimeout);
			resolve();
		};
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(finish);
			return;
		}
		finish();
	});
}

async function waitForProbeDomFlush(): Promise<void> {
	await tick();
	await Promise.resolve();
}

async function waitForHappyPathCondition(
	predicate: () => boolean,
	timeoutMs: number,
	frameStats?: MainAppHappyPathProbeFrameStats
): Promise<number | null> {
	const startedAtMs = performance.now();
	return waitForHappyPathConditionSince(predicate, timeoutMs, startedAtMs, frameStats);
}

async function waitForHappyPathConditionSince(
	predicate: () => boolean,
	timeoutMs: number,
	startedAtMs: number,
	frameStats?: MainAppHappyPathProbeFrameStats
): Promise<number | null> {
	while (performance.now() - startedAtMs < timeoutMs) {
		if (predicate()) {
			return roundPerfMs(performance.now() - startedAtMs);
		}
		await waitForProbeDomFlush();
		if (predicate()) {
			return roundPerfMs(performance.now() - startedAtMs);
		}
		await waitForProbeFrame(frameStats);
	}
	return null;
}

function formatHappyPathFocusLabel(documentHasFocus: boolean | null): string {
	if (documentHasFocus === null) {
		return "unknown";
	}
	return documentHasFocus ? "yes" : "no";
}

function readHappyPathTimingEnvironment(
	frameStats: MainAppHappyPathProbeFrameStats
): MainAppHappyPathTimingEnvironment {
	const visibilityState =
		typeof document !== "undefined" && typeof document.visibilityState === "string"
			? document.visibilityState
			: "unknown";
	const documentHasFocus =
		typeof document !== "undefined" && typeof document.hasFocus === "function"
			? document.hasFocus()
			: null;
	const requestAnimationFrameAvailable = typeof requestAnimationFrame === "function";
	const likelyThrottled =
		visibilityState !== "visible" ||
		documentHasFocus !== true ||
		frameStats.frameFallbackCount > 0 ||
		!requestAnimationFrameAvailable;
	return {
		visibilityState,
		documentHasFocus,
		requestAnimationFrameAvailable,
		frameWaitCount: frameStats.frameWaitCount,
		frameFallbackCount: frameStats.frameFallbackCount,
		likelyThrottled,
		label: `${visibilityState} focus=${formatHappyPathFocusLabel(documentHasFocus)} raf=${requestAnimationFrameAvailable ? "yes" : "no"} frameWaits=${frameStats.frameWaitCount.toString()} fallbacks=${frameStats.frameFallbackCount.toString()} throttled=${likelyThrottled ? "yes" : "no"}`,
	};
}

function summarizePanelOpenMarks(
	panelOpenMarks: Readonly<Record<string, number>>,
	panelDomReadyMs: number | null,
	composerReadyAfterCreateMs: number | null
): MainAppHappyPathPanelOpenMarkSummary {
	let panelFirstMarkMs: number | null = null;
	let panelLastMarkMs: number | null = null;
	for (const markMs of Object.values(panelOpenMarks)) {
		if (!Number.isFinite(markMs)) {
			continue;
		}
		if (panelFirstMarkMs === null || markMs < panelFirstMarkMs) {
			panelFirstMarkMs = markMs;
		}
		if (panelLastMarkMs === null || markMs > panelLastMarkMs) {
			panelLastMarkMs = markMs;
		}
	}
	const panelMarkedWorkMs =
		panelFirstMarkMs === null || panelLastMarkMs === null
			? null
			: roundPerfMs(panelLastMarkMs - panelFirstMarkMs);
	const panelDomReadyAfterLastMarkMs =
		panelLastMarkMs === null || panelDomReadyMs === null
			? null
			: roundPerfMs(panelDomReadyMs - panelLastMarkMs);
	const composerReadyAfterLastMarkMs =
		panelLastMarkMs === null || composerReadyAfterCreateMs === null
			? null
			: roundPerfMs(composerReadyAfterCreateMs - panelLastMarkMs);
	return {
		panelFirstMarkMs,
		panelLastMarkMs,
		panelMarkedWorkMs,
		panelPreMarkDelayMs: panelFirstMarkMs,
		panelDomReadyAfterLastMarkMs,
		composerReadyAfterLastMarkMs,
	};
}

function visibleElementExists(selector: string): boolean {
	const node = document.querySelector<HTMLElement>(selector);
	if (node === null) {
		return false;
	}
	const style = getComputedStyle(node);
	const rect = node.getBoundingClientRect();
	return (
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		Number(style.opacity) > 0 &&
		rect.width > 0 &&
		rect.height > 0
	);
}

function elementExists(selector: string): boolean {
	return document.querySelector(selector) !== null;
}

function resolveHappyPathProbeProject() {
	const focusedProjectPath = panelStore.focusedTopLevelPanel?.projectPath ?? null;
	if (focusedProjectPath !== null) {
		const focusedProject = projectManager.getProject(focusedProjectPath);
		if (focusedProject !== undefined) {
			return focusedProject;
		}
	}
	return projectManager.projects[0] ?? null;
}

function createHappyPathProbePanel(
	id = `${HAPPY_PATH_PROBE_PANEL_ID_PREFIX}${crypto.randomUUID()}`
) {
	const targetProject = resolveHappyPathProbeProject();
	if (targetProject !== null) {
		const panel = panelStore.spawnPanel({
			id,
			requireProjectSelection: false,
			projectPath: targetProject.path,
			pendingWorktreeEnabled: false,
		});
		happyPathProbePanelIds.add(panel.id);
		return panel;
	}
	const panel = panelStore.spawnPanel({
		id,
		requireProjectSelection: true,
		pendingWorktreeEnabled: false,
	});
	happyPathProbePanelIds.add(panel.id);
	return panel;
}

function isSessionlessHappyPathProbeCandidate(panel: {
	readonly id: string;
	readonly sessionId: string | null;
	readonly agentId: string | null;
	readonly sourcePath: string | null;
	readonly worktreePath: string | null;
	readonly ownerPanelId: string | null;
	readonly kind: string;
}): boolean {
	return (
		panel.kind === "agent" &&
		panel.ownerPanelId === null &&
		panel.sessionId === null &&
		panel.agentId === null &&
		panel.sourcePath === null &&
		panel.worktreePath === null
	);
}

function cleanupHappyPathProbePanels(
	options: MainAppHappyPathProbeCleanupOptions = {}
): MainAppHappyPathProbeCleanupResult {
	const closeSessionlessCandidates = options.closeSessionlessCandidates === true;
	const targetPanelIds: string[] = [];
	for (const panel of panelStore.panels) {
		const shouldCloseKnownProbe =
			happyPathProbePanelIds.has(panel.id) || panel.id.startsWith(HAPPY_PATH_PROBE_PANEL_ID_PREFIX);
		const shouldCloseCandidate =
			closeSessionlessCandidates && isSessionlessHappyPathProbeCandidate(panel);
		if (!shouldCloseKnownProbe && !shouldCloseCandidate) {
			continue;
		}
		targetPanelIds.push(panel.id);
	}

	for (const panelId of targetPanelIds) {
		viewState.handleClosePanel(panelId);
		happyPathProbePanelIds.delete(panelId);
	}

	return {
		closedPanelIds: targetPanelIds,
		remainingPanelCount: panelStore.panels.length,
		remainingDomPanelCount: document.querySelectorAll("[data-testid='agent-panel-host']").length,
	};
}

async function runHappyPathProbe(
	options: MainAppHappyPathProbeOptions = {}
): Promise<MainAppHappyPathProbeResult> {
	cleanupHappyPathProbePanels();
	const frameStats: MainAppHappyPathProbeFrameStats = {
		frameWaitCount: 0,
		frameFallbackCount: 0,
	};
	const shellReadyWaitMs = await waitForHappyPathCondition(
		() => viewState.shellReady,
		options.timeoutMs ?? 20_000,
		frameStats
	);
	const initializationWaitMs = await waitForHappyPathCondition(
		() => viewState.initializationComplete,
		options.timeoutMs ?? 20_000,
		frameStats
	);
	const projectReadyWaitMs =
		projectManager.projects.length > 0
			? 0
			: await waitForHappyPathCondition(
					() => projectManager.projects.length > 0,
					Math.min(options.timeoutMs ?? 20_000, 2_000),
					frameStats
				);
	const projectReady = projectManager.projects.length > 0;
	const projectCountAtPanelCreate = projectManager.projects.length;
	const totalStartedAtMs = performance.now();
	const panelCountBefore = panelStore.panels.length;
	const domPanelCountBefore = document.querySelectorAll("[data-testid='agent-panel-host']").length;
	const panelCreateStartedAtMs = performance.now();
	const probePanelId = `${HAPPY_PATH_PROBE_PANEL_ID_PREFIX}${crypto.randomUUID()}`;
	const panelSelector = `[data-qa-agent-panel-id="${CSS.escape(probePanelId)}"]`;
	const composerSelector = `${panelSelector} [contenteditable=true], ${panelSelector} textarea`;
	const panelOpenMarks: Record<string, number> = {};
	const previousPanelOpenMarkRecorder = window.__acepeRecordPanelOpenPerformanceMark;
	window.__acepeRecordPanelOpenPerformanceMark = (targetPanelId, name, timestampMs) => {
		if (targetPanelId === probePanelId) {
			panelOpenMarks[name] = roundPerfMs(timestampMs - panelCreateStartedAtMs);
		}
		previousPanelOpenMarkRecorder?.(targetPanelId, name, timestampMs);
	};
	let panelDomMutationMs: number | null = null;
	let composerMutationMs: number | null = null;
	const recordPanelOpenMutation = (): void => {
		if (panelDomMutationMs === null && elementExists(panelSelector)) {
			panelDomMutationMs = roundPerfMs(performance.now() - panelCreateStartedAtMs);
		}
		if (composerMutationMs === null && visibleElementExists(composerSelector)) {
			composerMutationMs = roundPerfMs(performance.now() - panelCreateStartedAtMs);
		}
	};
	let panelOpenObserver: MutationObserver | null = null;
	if (typeof MutationObserver === "function") {
		panelOpenObserver = new MutationObserver(() => {
			recordPanelOpenMutation();
			if (panelDomMutationMs !== null && composerMutationMs !== null) {
				panelOpenObserver?.disconnect();
			}
		});
	}
	panelOpenObserver?.observe(document.body, { childList: true, subtree: true });
	const panel = createHappyPathProbePanel(probePanelId);
	panelStore.focusPanel(panel.id);
	const panelCreateMs = roundPerfMs(performance.now() - panelCreateStartedAtMs);
	recordPanelOpenMutation();
	const panelDomPresentAfterCreate = elementExists(panelSelector);
	let panelDomAfterDomFlushMs: number | null = null;
	let panelDomAfterFirstFrameMs: number | null = null;

	if (!panelDomPresentAfterCreate) {
		await waitForProbeDomFlush();
		if (elementExists(panelSelector)) {
			panelDomAfterDomFlushMs = roundPerfMs(performance.now() - panelCreateStartedAtMs);
		}
	}

	if (!panelDomPresentAfterCreate && panelDomAfterDomFlushMs === null) {
		await waitForProbeFrame(frameStats);
		if (elementExists(panelSelector)) {
			panelDomAfterFirstFrameMs = roundPerfMs(performance.now() - panelCreateStartedAtMs);
		}
	}

	const panelDomReadyMs =
		panelDomPresentAfterCreate ||
		panelDomAfterDomFlushMs !== null ||
		panelDomAfterFirstFrameMs !== null
			? roundPerfMs(performance.now() - panelCreateStartedAtMs)
			: await waitForHappyPathConditionSince(
					() => elementExists(panelSelector),
					2_000,
					panelCreateStartedAtMs,
					frameStats
				);
	const composerReadyMs = await waitForHappyPathCondition(
		() => visibleElementExists(composerSelector),
		2_000,
		frameStats
	);
	const composerReadyAfterCreateMs =
		composerReadyMs === null ? null : roundPerfMs(performance.now() - panelCreateStartedAtMs);
	const panelOpenMarkSummary = summarizePanelOpenMarks(
		panelOpenMarks,
		panelDomReadyMs,
		composerReadyAfterCreateMs
	);
	recordPanelOpenMutation();
	panelOpenObserver?.disconnect();
	if (previousPanelOpenMarkRecorder === undefined) {
		delete window.__acepeRecordPanelOpenPerformanceMark;
	} else {
		window.__acepeRecordPanelOpenPerformanceMark = previousPanelOpenMarkRecorder;
	}
	const panelNode = document.querySelector(panelSelector);
	const panelDomNodeCount = panelNode === null ? 0 : panelNode.querySelectorAll("*").length + 1;
	const panelRowNodeCount =
		panelNode === null ? 0 : panelNode.querySelectorAll("[data-row-id]").length;
	const panelDropdownContentNodeCount = document.querySelectorAll(
		"[data-slot='dropdown-menu-content']"
	).length;
	const resizeObserverConstructCount = null;
	const resizeObserverObserveCount = null;
	const resizeObserverCallbackCount = null;

	const closeCallStartedAtMs = performance.now();
	viewState.handleClosePanel(panel.id);
	const closeCallReturnMs = roundPerfMs(performance.now() - closeCallStartedAtMs);
	const closeTrace = panelStore.getLastClosePerformanceTrace();
	happyPathProbePanelIds.delete(panel.id);
	await Promise.resolve();
	const closeMicrotaskMs = roundPerfMs(performance.now() - closeCallStartedAtMs);
	const closeDomGoneAfterMicrotask = document.querySelector(panelSelector) === null;
	let closeFirstFrameMs: number | null = null;
	let closeDomGoneAfterFirstFrame = closeDomGoneAfterMicrotask;
	let closeDomGoneMs: number | null = closeDomGoneAfterMicrotask ? closeMicrotaskMs : null;
	if (!closeDomGoneAfterMicrotask) {
		await waitForProbeFrame(frameStats);
		closeFirstFrameMs = roundPerfMs(performance.now() - closeCallStartedAtMs);
		closeDomGoneAfterFirstFrame = document.querySelector(panelSelector) === null;
		closeDomGoneMs = closeDomGoneAfterFirstFrame
			? closeFirstFrameMs
			: await waitForHappyPathConditionSince(
					() => document.querySelector(panelSelector) === null,
					2_000,
					closeCallStartedAtMs,
					frameStats
				);
	}

	const startupTrace = viewState.getStartupPerformanceTrace();
	const shellReadyTrace = startupTrace.find((entry) => entry.name === "shellReady") ?? null;
	const initializeTrace = startupTrace.find((entry) => entry.name === "initialize") ?? null;
	const shellReadyAtMs =
		shellReadyTrace?.completedAtMs === undefined ? null : shellReadyTrace.completedAtMs;
	const initializationCompleteAtMs =
		mainAppInitializationCompleteAtMs ??
		(initializeTrace?.completedAtMs === undefined ? null : initializeTrace.completedAtMs);
	const initializationDurationMs =
		mainAppMountStartedAtMs !== null && mainAppInitializationCompleteAtMs !== null
			? roundPerfMs(mainAppInitializationCompleteAtMs - mainAppMountStartedAtMs)
			: (initializeTrace?.durationMs ?? null);

	return {
		hookAvailable: true,
		route: window.location.pathname,
		runtimeErrors: readRuntimeErrorMessages(),
		timingEnvironment: readHappyPathTimingEnvironment(frameStats),
		navigation: readMainAppNavigationTiming(),
		app: {
			mountStartedAtMs:
				mainAppMountStartedAtMs === null ? null : roundPerfMs(mainAppMountStartedAtMs),
			shellReadyAtMs: shellReadyAtMs === null ? null : roundPerfMs(shellReadyAtMs),
			shellReadyDurationMs: shellReadyTrace?.durationMs ?? null,
			shellReady: viewState.shellReady,
			shellReadyWaitMs,
			initializationCompleteAtMs:
				initializationCompleteAtMs === null ? null : roundPerfMs(initializationCompleteAtMs),
			initializationDurationMs,
			initializationComplete: viewState.initializationComplete,
			initializationWaitMs,
			projectReady,
			projectReadyWaitMs,
			projectCountAtPanelCreate,
			startupTrace,
			projectLoadTrace: projectManager.getLastLoadPerformanceTrace(),
			tauriInvokeTimings: readCurrentMountTauriInvokeTimings(),
			panelCountBefore,
			panelCountAfter: panelStore.panels.length,
			domPanelCountBefore,
			domPanelCountAfter: document.querySelectorAll("[data-testid='agent-panel-host']").length,
		},
		openClose: {
			panelId: panel.id,
			projectPath: panel.projectPath ?? null,
			panelOpenMarks,
			panelFirstMarkMs: panelOpenMarkSummary.panelFirstMarkMs,
			panelLastMarkMs: panelOpenMarkSummary.panelLastMarkMs,
			panelMarkedWorkMs: panelOpenMarkSummary.panelMarkedWorkMs,
			panelPreMarkDelayMs: panelOpenMarkSummary.panelPreMarkDelayMs,
			panelDomReadyAfterLastMarkMs: panelOpenMarkSummary.panelDomReadyAfterLastMarkMs,
			composerReadyAfterLastMarkMs: panelOpenMarkSummary.composerReadyAfterLastMarkMs,
			panelCreateMs,
			panelDomPresentAfterCreate,
			panelDomMutationMs,
			panelDomAfterDomFlushMs,
			panelDomAfterFirstFrameMs,
			panelDomReadyMs,
			composerMutationMs,
			composerReadyMs,
			composerReadyAfterCreateMs,
			panelDomNodeCount,
			panelRowNodeCount,
			panelDropdownContentNodeCount,
			resizeObserverConstructCount,
			resizeObserverObserveCount,
			resizeObserverCallbackCount,
			closeCallReturnMs,
			closeMicrotaskMs,
			closeDomGoneAfterMicrotask,
			closeFirstFrameMs,
			closeDomGoneAfterFirstFrame,
			closeDomGoneMs,
			closeTrace: closeTrace?.panelId === panel.id ? closeTrace : null,
			totalMs: roundPerfMs(performance.now() - totalStartedAtMs),
		},
	};
}

function runSessionOpenContentProbeForQa(
	options: SessionOpenContentProbeOptions
): Promise<SessionOpenContentProbeResult> {
	return runSessionOpenContentProbe(
		{
			document,
			hostWindow: window,
			performance,
			viewState,
			panelStore,
			sessionStore,
			readRuntimeErrors: readRuntimeErrorMessages,
			readTauriInvokeTimings: getTauriInvokeTimings,
			readPendingTauriInvokes: getPendingTauriInvokes,
		},
		options
	);
}

const QA_HOOKS_ENABLED =
	import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_HOOKS === "1";

function installHappyPathProbeQaHook(): void {
	if (!QA_HOOKS_ENABLED) {
		return;
	}
	window.__acepeHappyPathProbe = runHappyPathProbe;
	window.__acepeSessionOpenContentProbe = runSessionOpenContentProbeForQa;
	window.__acepeCleanupHappyPathProbePanels = cleanupHappyPathProbePanels;
}

function uninstallHappyPathProbeQaHook(): void {
	if (window.__acepeHappyPathProbe === runHappyPathProbe) {
		delete window.__acepeHappyPathProbe;
	}
	if (window.__acepeSessionOpenContentProbe === runSessionOpenContentProbeForQa) {
		delete window.__acepeSessionOpenContentProbe;
	}
	if (window.__acepeCleanupHappyPathProbePanels === cleanupHappyPathProbePanels) {
		delete window.__acepeCleanupHappyPathProbePanels;
	}
}

// Create selector registry context BEFORE app state so components can use it
// This enables focused panel dispatch for model/mode keybindings
const selectorRegistry = setSelectorRegistryContext();

// Create stores in dependency order (Context Composition pattern)
const agentStore = createAgentStore();
const agentPreferencesStore = createAgentPreferencesStore();
const sessionStore = createSessionStore();
const interactionStore = createInteractionStore();
const permissionStore = createPermissionStore(interactionStore);
const questionStore = createQuestionStore(interactionStore);
// QuestionSelectionStore is accessed via getQuestionSelectionStore() context, no direct reference needed
createQuestionSelectionStore();
// QueueStore is accessed via getQueueStore() context, no direct reference needed
createQueueStore();
// MessageQueueStore for per-session message stacking
const messageQueueStore = createSessionMessageQueueStore(sessionStore);
const planStore = createPlanStore();
sessionStore.onSessionRemoved((id) => {
	planStore.clear(id);
	messageQueueStore.removeForSession(id);
	interactionStore.clearSession(id);
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
const analyticsPrefsStore = createAnalyticsPreferencesStore();
const attentionQueueStore = createAttentionQueueStore();
const dismissedTipsStore = createDismissedTipsStore();

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
const sessionOpenHydrator = new SessionOpenHydrator(
	sessionStore,
	panelStore,
	createSessionOpenInteractionGraphConsumer({ interactionStore })
);
sessionStore.connection.setSessionOpenHydrator(sessionOpenHydrator);
panelStore.setDuplicatePanelDisposalHandler((panelId) => {
	sessionOpenHydrator.clearAttempt(panelId);
});
// Create voice settings store (context for agent-input-ui composer voice controls)
const voiceSettingsStore = createVoiceSettingsStore();
createPreconnectionAgentSkillsStore();

// Passive panel focus alone does not acknowledge completion.
panelStore.onPanelFocused = null;

// Get connection store (created earlier, now accessible)
const connectionStore = getConnectionStore();

function focusOrOpenSessionPanel(sessionId: string, acknowledgeCompletion = false): void {
	const existingPanel = panelStore.getPanelBySessionId(sessionId);
	if (existingPanel) {
		panelStore.focusPanel(existingPanel.id);
		if (acknowledgeCompletion) {
			acknowledgeExplicitPanelReveal(unseenStore, existingPanel);
		}
		return;
	}

	const openedPanel = panelStore.openSession(sessionId, DEFAULT_PANEL_WIDTH);
	if (openedPanel) {
		panelStore.focusPanel(openedPanel.id);
		if (acknowledgeCompletion) {
			acknowledgeExplicitPanelReveal(unseenStore, openedPanel);
		}
	}
}

function showPermissionNotification(
	permission: import("$lib/acp/types/permission.js").PermissionRequest
): void {
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
			if (!interactionStore.permissionsPending.has(permission.id)) return;
			if (actionId === "allow") {
				permissionStore.reply(permission.id, "once");
			} else if (actionId === "allow-always") {
				permissionStore.reply(permission.id, "always");
			} else if (actionId === "deny") {
				permissionStore.reply(permission.id, "reject");
			} else if (actionId === "view") {
				focusOrOpenSessionPanel(permission.sessionId);
			}
		},
		{
			windowFocused: windowFocusStore.isFocused,
			categoryEnabled: notificationPrefsStore.questionsEnabled,
		}
	);
}

function showQuestionNotification(question: QuestionRequest): void {
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
			if (!interactionStore.questionsPending.has(question.id)) return;
			if (actionId === "view") {
				focusOrOpenSessionPanel(question.sessionId);
			}
		},
		{
			windowFocused: windowFocusStore.isFocused,
			categoryEnabled: notificationPrefsStore.questionsEnabled,
		}
	);
}

function showPlanApprovalNotification(approval: PlanApprovalInteraction): void {
	const body =
		approval.source === "exit_plan_mode" ? "Approve exiting plan mode" : "Approve generated plan";
	showNotification(
		{
			id: approval.id,
			type: "question",
			title: "Plan Approval",
			body,
			actions: QUESTION_ACTIONS,
			sessionId: approval.sessionId,
			sourceId: approval.id,
		},
		(actionId) => {
			if (interactionStore.planApprovalsPending.get(approval.id)?.status !== "pending") return;
			if (actionId === "view") {
				focusOrOpenSessionPanel(approval.sessionId);
			}
		},
		{
			windowFocused: windowFocusStore.isFocused,
			categoryEnabled: notificationPrefsStore.questionsEnabled,
		}
	);
}

sessionStore.connection.setLiveSessionStateGraphConsumer(
	createLiveInteractionGraphConsumer({
		interactionStore,
		showPermissionNotification,
		showQuestionNotification,
		showPlanApprovalNotification,
	})
);

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
			const identity = sessionStore.read.getSessionIdentity(sessionId);
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
		applyCompletionAttentionAction(unseenStore, panel.id, {
			kind: "turn-complete",
			panelIsFocused: panel.id === panelStore.focusedPanelId,
		});

		// Show completion popup notification when app is unfocused
		const sessionTitle = sessionStore.read.getSessionMetadata(sessionId)?.title ?? "Task";
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
					focusOrOpenSessionPanel(sessionId, true);
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
});

// Project manager (separate for now, could be merged later)
const projectManager = new ProjectManager();
// App-wide new-chat modal: opened from any new-thread entry point via
// viewState.onNewThreadOverride (registered in onMount once the ref is bound).
let newChatDialog = $state<{ open: (request?: KanbanNewSessionRequest) => void }>();

// Connect session store to project manager for scan operations on import
projectManager.setSessionStore(sessionStore);

// Set up project color lookup for urgency tabs store and tab bar
// This ensures tabs use actual project colors instead of hash-based fallbacks
const projectColorLookup = (projectPath: string) => {
	const project = projectManager.getProject(projectPath);
	return project?.color ?? null;
};
const projectIconSrcLookup = (projectPath: string) => {
	const project = projectManager.getProject(projectPath);
	return project?.iconPath ?? null;
};
urgencyTabsStore.setProjectColorLookup(projectColorLookup);
tabBarStore.setProjectColorLookup(projectColorLookup);
tabBarStore.setProjectIconSrcLookup(projectIconSrcLookup);

// Set up project creation date lookup for tab bar group ordering
const projectCreatedAtLookup = (projectPath: string) => {
	const project = projectManager.getProject(projectPath);
	return project?.createdAt ?? null;
};
tabBarStore.setProjectCreatedAtLookup(projectCreatedAtLookup);

// Set up project sort order lookup for flat tab ordering (smallest first)
const projectSortOrderLookup = (projectPath: string) => {
	const project = projectManager.getProject(projectPath);
	return project?.sortOrder ?? null;
};
tabBarStore.setProjectSortOrderLookup(projectSortOrderLookup);

// Inbound request handler for JSON-RPC requests from ACP subprocess (e.g., requestPermission)
const inboundRequestHandler = new InboundRequestHandler();

function startLegacyInboundRequestHandler(): void {
	logger.info("main-app-view: Starting legacy InboundRequestHandler");
	void inboundRequestHandler
		.start((permission) => {
			logger.error("Legacy inbound permission request ignored; expected canonical graph patch", {
				permissionId: permission.id,
				sessionId: permission.sessionId,
				jsonRpcRequestId: permission.jsonRpcRequestId,
			});
		})
		.match(
			() => {
				logger.info("main-app-view: Legacy InboundRequestHandler started successfully");
			},
			(error) => {
				logger.error("[Startup] Failed to start legacy InboundRequestHandler:", error);
				viewState.initializationError = error;
			}
		);
}

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
	sessionOpenHydrator
);

// Route every new-thread entry point (sidebar "New chat", per-project +, ⌘T,
// kanban columns) to the single app-wide new-chat modal. The closure reads the
// dialog ref at call time, so it works regardless of mount/HMR ordering.
viewState.onNewThreadOverride = (request) => newChatDialog?.open(request);

// Add repository dialog (unified import/clone/browse modal)
const projectClient = new ProjectClient();
let addProjectDialogOpen = $state(false);
let startupMaximizeTriggered = false;
let hmrTeardownActive = false;

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		hmrTeardownActive = true;
	});
}

function handleAddProjectOpen(path: string, name: string) {
	const project = {
		path,
		name,
		createdAt: new Date(),
		color: "cyan",
	};
	projectManager.addProject(project).match(
		() => {
			sessionStore.loading.scanSessions([path]).mapErr(() => {});
			panelStore.spawnPanel({
				projectPath: path,
				pendingWorktreeEnabled: worktreeDefaultStore.globalDefault,
			});
		},
		(error) => {
			toast.error(`Failed to open project: ${error.message}`);
		}
	);
}

function handleAddProjectImported(path: string, name: string) {
	projectManager.addProjectOptimistic(path, name);
	projectManager.loadProjects().mapErr(() => {});
	sessionStore.loading.scanSessions([path]).mapErr(() => {});
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
	if (!canMaximizeFromStartupGate(viewState.showSplash)) {
		return;
	}

	maximizeWindow();
}

// Update state (for forced auto-updates) - now safe to use $state since we renamed 'state' to 'viewState'
// Start with null - will be set to "checking" when update check runs (only in production)
let appVersion = $state<string | null>(null);
let updaterState = $state<UpdaterBannerState>(createIdleUpdaterState());
let availableUpdate = $state<Awaited<ReturnType<typeof check>> | null>(null);
let updatePollTimer = $state<ReturnType<typeof setInterval> | null>(null);
let devUpdateStartTimer = $state<ReturnType<typeof setTimeout> | null>(null);
let devUpdateStepTimer = $state<ReturnType<typeof setInterval> | null>(null);

type UpdateCheckTrigger = "startup" | "polling";

const DEV_UPDATE_VERSION = "2026.4.4";
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
	label: "Jump to Urgent",
	description: "Focus the most urgent tab (asking question or error)",
	category: "navigation",
	handler: () => {
		const firstTab = urgencyTabsStore.firstTab;
		if (firstTab) {
			panelStore.focusPanel(firstTab.panelId);
			acknowledgeExplicitPanelReveal(unseenStore, panelStore.getPanel(firstTab.panelId));
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

function getProjectDialogPathLabel(projectPath: string): string {
	const segments = projectPath.split("/").filter((segment) => segment.length > 0);
	const lastSegment = segments[segments.length - 1];
	return lastSegment ?? projectPath;
}

function getProjectDialogName(dialog: ProjectFileSystemDialogState): string {
	const project = projectManager.getProject(dialog.projectPath);
	return dialog.projectName ?? project?.name ?? getProjectDialogPathLabel(dialog.projectPath);
}

function getProjectDialogColor(dialog: ProjectFileSystemDialogState): string | undefined {
	const project = projectManager.getProject(dialog.projectPath);
	return dialog.projectColor ?? project?.color;
}

function getProjectDialogIconSrc(dialog: ProjectFileSystemDialogState): string | null {
	const project = projectManager.getProject(dialog.projectPath);
	return dialog.projectIconSrc ?? project?.iconPath ?? null;
}

function buildProjectDialogOpenFileOptions(
	dialog: ProjectFileSystemDialogState | null,
	projectPath: string,
	filePath: string
): OpenFilePanelOptions | undefined {
	if (
		dialog === null ||
		dialog.projectPath !== projectPath ||
		dialog.filePath !== filePath ||
		(dialog.targetLine === null && dialog.targetColumn === null)
	) {
		return undefined;
	}

	const options: OpenFilePanelOptions = {};
	if (dialog.targetLine !== null) {
		options.targetLine = dialog.targetLine;
	}
	if (dialog.targetColumn !== null) {
		options.targetColumn = dialog.targetColumn;
	}
	return options;
}

function handleProjectFileSystemDialogOpenFile(projectPath: string, filePath: string): void {
	const options = buildProjectDialogOpenFileOptions(
		panelStore.projectFileSystemDialog,
		projectPath,
		filePath
	);
	if (options === undefined) {
		panelStore.openFilePanel(filePath, projectPath);
	} else {
		panelStore.openFilePanel(filePath, projectPath, options);
	}
	panelStore.closeProjectFileSystemDialog();
}

function openStreamingReproLabForQa(): boolean {
	viewState.debugPanelOpen = true;
	return true;
}

function installStreamingReproQaHook(): void {
	if (!import.meta.env.DEV) {
		return;
	}
	window.__acepeOpenStreamingReproLab = openStreamingReproLabForQa;
}

function uninstallStreamingReproQaHook(): void {
	if (!import.meta.env.DEV) {
		return;
	}
	if (window.__acepeOpenStreamingReproLab === openStreamingReproLabForQa) {
		delete window.__acepeOpenStreamingReproLab;
	}
}

async function checkForAppUpdate(_trigger: UpdateCheckTrigger): Promise<void> {
	// Never block the app on update checks: check in the background, download
	// in the background, and surface an "Update" button top-left when ready.
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
		attemptStartupMaximize();
		return;
	}

	availableUpdate = result;
	logger.info("Update available", { version: result.version });
	attemptStartupMaximize();
	void predownloadAvailableUpdate();
}

async function predownloadAvailableUpdate(): Promise<void> {
	if (!availableUpdate) {
		return;
	}

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

async function installAvailableUpdate(): Promise<void> {
	if (!availableUpdate) {
		return;
	}

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
	mainAppMountStartedAtMs = performance.now();
	mainAppInvokeTimingBaselineIndex = getTauriInvokeTimings().length;
	installHappyPathProbeQaHook();

	// Initialize the app state (handles all initialization logic including background scan)
	const initResult = await viewState.initialize();
	mainAppInitializationCompleteAtMs = performance.now();

	void import("@tauri-apps/api/app")
		.then((mod) => mod.getVersion())
		.then((version) => {
			appVersion = version;
		});

	if (import.meta.env.DEV) {
		installStreamingReproQaHook();
		updaterState = createAvailableUpdaterState(DEV_UPDATE_VERSION);
	} else {
		void checkForAppUpdate("startup");
		updatePollTimer = setInterval(
			() => {
				if (
					updaterState.kind === "downloading" ||
					updaterState.kind === "installing" ||
					availableUpdate !== null
				) {
					return;
				}
				void checkForAppUpdate("polling");
			},
			10 * 60 * 1000
		);
	}
	attemptStartupMaximize();

	// Initialize notification popup focus tracking. Persisted preferences below
	// have safe defaults and are loaded after the shell is measurable.
	windowFocusStore.initialize();

	if (initResult.isErr()) {
		logger.error("[Startup] Initialization failed:", initResult.error);
		viewState.initializationError = initResult.error;
	}
	window.setTimeout(() => {
		playSound(SoundEffect.AppStart);
		preloadSound(SoundEffect.DictationStart);
		preloadSound(SoundEffect.DictationStop);
		preloadSound(SoundEffect.Notification);
		preloadSound(SoundEffect.Paste);
	}, 0);
	scheduleNonCriticalStartupWork(() => {
		void chatPreferencesStore.initialize();
		void reviewPreferenceStore.initialize();
		void planPreferenceStore.initialize();
		void notificationPrefsStore.initialize();
		void analyticsPrefsStore.initialize();
		void attentionQueueStore.initialize();
		void voiceSettingsStore.initialize();
		void dismissedTipsStore.initialize();
		void worktreeDefaultStore.load().mapErr((error) => {
			logger.error("Failed to load worktree default preference", { error });
		});
	});
	scheduleNonCriticalStartupWork(() => {
		void agentModelPreferencesStore.loadPersistedState().match(
			() => undefined,
			(error) => {
				logger.warn("Failed to load agent model preferences after startup", { error });
			}
		);
	});
	scheduleNonCriticalStartupWork(startLegacyInboundRequestHandler);

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

function handleSessionCreated(sessionId: string) {
	panelStore.openSession(sessionId, DEFAULT_PANEL_WIDTH);
}

// Handle onboarding completion (splash → agents → projects → done)
function handleOnboardingDismiss() {
	writeSplashSeenHotCache(true);
	tauriClient.settings.setRaw("has_seen_splash", "true").mapErr((error) => {
		logger.error("Failed to save onboarding completion", { error });
	});

	// Reload projects + session history so sidebar shows imported projects
	projectManager.loadProjects().map(() => {
		const projectPaths = projectManager.projects.map((p) => p.path);
		if (projectPaths.length > 0) {
			sessionStore.loading.loadSessions(projectPaths);
		}
	});
	viewState.dismissSplash();
	attemptStartupMaximize();
}

function handleDevResetOnboarding() {
	void agentPreferencesStore.resetOnboardingForDev().match(
		() => {
			startupMaximizeTriggered = false;
			viewState.showSplash = true;
			toast.success("Onboarding reset");
		},
		(error) => {
			toast.error(error.message);
		}
	);
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
	!viewState.reviewFullscreenOpen && viewState.isFullscreen && tabBarStore.tabs.length > 1
);

// Cleanup on destroy
onDestroy(() => {
	uninstallHappyPathProbeQaHook();
	// Disconnect all sessions to kill their subprocesses
	// This prevents orphaned Claude processes when the app closes
	if (shouldDisconnectSessionsOnMainAppDestroy({ hmrTeardownActive })) {
		sessionStore.connection.disconnectAllSessions();
	}
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
	uninstallStreamingReproQaHook();
	if (updatePollTimer) {
		clearInterval(updatePollTimer);
	}
	clearDevUpdateSimulation();
});
</script>

<ThemeProvider class="overflow-hidden h-dvh bg-background">
	<div
		class="flex flex-col h-full min-h-0 p-0.5 gap-0.5 overflow-hidden"
		role="application"
		aria-label={"Application"}
		data-acepe-shell-ready={viewState.shellReady ? "true" : "false"}
		oncontextmenu={handleContextMenu}
	>
		<!-- Top bar -->
		<div class="shrink-0 overflow-hidden">
			<TopBar
				{viewState}
				onDevSimulateUpdate={() => {
					startDevUpdateSimulation();
				}}
				onDevShowDesignSystem={() => {
					viewState.designSystemOpen = true;
				}}
				onDevShowStreamingReproLab={() => {
					viewState.debugPanelOpen = true;
				}}
				onDevResetOnboarding={handleDevResetOnboarding}
			></TopBar>
		</div>
		{#if viewState.settingsModalOpen}
			<div class={resolveWorkspaceFrameClass()}>
				<svelte:boundary onerror={(e) => console.error('[boundary:settings]', e)}>
					<SettingsPage {projectManager} onBack={() => viewState.closeSettings()} />
					{#snippet failed(error, reset)}
						<div class="flex flex-1 items-center justify-center p-4">
							<div class="flex flex-col items-center gap-2 text-muted-foreground text-xs">
								<span>{"Settings encountered an error."}</span>
								<button class="underline hover:text-foreground" onclick={reset}>{"Retry"}</button>
							</div>
						</div>
					{/snippet}
				</svelte:boundary>
			</div>
		{:else if !viewState.reviewFullscreenOpen}
			<div class={resolveWorkspaceFrameClass()}>
				{#if showSidebar}
					<div class={resolveWorkspaceSidebarClass(viewState.sidebarOpen)}>
						<svelte:boundary onerror={(e) => console.error('[boundary:sidebar]', e)}>
							<AppSidebar
							{projectManager}
							state={viewState}
							onImportProject={() => (addProjectDialogOpen = true)}
							updaterState={updaterState}
							onUpdateClick={() => {
								if (
									getUpdaterPrimaryAction(import.meta.env.DEV, availableUpdate !== null) === "simulate"
								) {
									startDevUpdateSimulation();
									return;
								}
								void installAvailableUpdate();
							}}
							onRetryUpdateClick={() => {
								void checkForAppUpdate("polling");
							}}
						/>
							{#snippet failed(error, reset)}
								<div class="flex flex-1 items-center justify-center p-4">
									<div class="flex flex-col items-center gap-2 text-muted-foreground text-xs">
										<span>{"Sidebar encountered an error."}</span>
										<button class="underline hover:text-foreground" onclick={reset}>{"Retry"}</button>
									</div>
								</div>
							{/snippet}
						</svelte:boundary>
					</div>
				{/if}
				<main
					class="flex-1 flex min-h-0 flex-col gap-0.5 overflow-hidden transition-[background-color] duration-200 ease-out {showPanelsContainer || viewState.designSystemOpen
						? ''
						: 'justify-center items-center overflow-x-auto'}"
				>
					<!-- Tab bar (project cards + tabs): only above panel column, aligned with main -->
					{#if showTabBarStrip}
						<div class="shrink-0 overflow-hidden">
							<TabBar
								tabs={tabBarStore.sortedTabs}
								badgeLabelByPath={projectManager.badgeLabelByPath}
								activeContrast={panelStore.viewMode === "single" ? "strong" : "normal"}
								onSelectTab={(panelId) => {
									panelStore.focusAndSwitchToPanel(panelId);
									acknowledgeExplicitPanelReveal(unseenStore, panelStore.getPanel(panelId));
								}}
								onCloseTab={(panelId) => viewState.handleClosePanel(panelId)}
							/>
						</div>
					{/if}
					<svelte:boundary onerror={(e) => console.error('[boundary:main-content]', e)}>
						{#if viewState.designSystemOpen}
							<DesignSystemPage
								onClose={() => {
									viewState.designSystemOpen = false;
								}}
							/>
						{:else if showPanelsContainer}
							<div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
								<PanelsContainer
									{projectManager}
									state={viewState}
									onFocusPanel={(panelId) => {
										viewState.handleFocusPanel(panelId);
										acknowledgeExplicitPanelReveal(unseenStore, panelStore.getPanel(panelId));
									}}
									onToggleFullscreenPanel={(panelId) => {
										performExplicitPanelReveal(unseenStore, panelStore.getPanel(panelId), () => {
											viewState.handleToggleFullscreen(panelId);
										});
									}}
								/>
							</div>
						{:else if viewState.initializationComplete && !viewState.workspaceRestorationPending}
							<EmptyStates {projectManager} onSessionCreated={handleSessionCreated} />
						{/if}
						{#snippet failed(error, reset)}
							<div class="flex flex-1 items-center justify-center p-4">
								<div class="flex flex-col items-center gap-2 text-muted-foreground text-sm">
									<span>{"This panel encountered an error."}</span>
									<button class="text-xs underline hover:text-foreground" onclick={reset}>{"Retry"}</button>
								</div>
							</div>
						{/snippet}
					</svelte:boundary>
				</main>
			</div>
		{/if}
	</div>
	<AppOverlays state={viewState} {commandPalette} />
	<SourceControlDialog {projectManager} />
	<NewChatDialog bind:this={newChatDialog} {projectManager} />

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
				class="mx-auto h-full max-h-[820px] w-full max-w-[1180px] overflow-hidden rounded-lg border border-border/60 bg-background shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
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

	{#if panelStore.projectFileSystemDialog !== null}
		{@const dialogTarget = panelStore.projectFileSystemDialog}
		{#key dialogTarget.id}
			<ProjectFileSystemDialog
				open={true}
				projectPath={dialogTarget.projectPath}
				projectName={getProjectDialogName(dialogTarget)}
				projectColor={getProjectDialogColor(dialogTarget)}
				projectIconSrc={getProjectDialogIconSrc(dialogTarget)}
				title={dialogTarget.title}
				initialFilePath={dialogTarget.filePath}
				onClose={() => {
					panelStore.closeProjectFileSystemDialog();
				}}
				onOpenFile={handleProjectFileSystemDialogOpenFile}
			/>
		{/key}
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

</ThemeProvider>
