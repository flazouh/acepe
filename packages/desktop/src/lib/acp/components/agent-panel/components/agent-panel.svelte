<script lang="ts">
import {
	AgentPanelShell,
	type AgentPanelPlanActionEvent,
	type AgentPanelPlanViewEvent,
	type AgentPanelQuestionSelectEvent,
	type AgentPanelReviewActionEvent,
	type AgentPanelSceneEntryModel,
	type AgentUserFileSelectEvent,
	type AgentToolFileSelectEvent,
} from "@acepe/ui/agent-panel";
import { DiffPill, RoundedIcon, setThinkingPreferences, type PrChecksItem } from "@acepe/ui";
import { Button } from "@acepe/ui/button";
import * as ButtonGroup from "@acepe/ui/button-group";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { onDestroy, onMount, tick } from "svelte";
import { toast } from "svelte-sonner";
import type { TurnState } from "../../../store/types.js";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import AgentAttachedFilePane from "../../../../components/main-app-view/components/content/agent-attached-file-pane.svelte";
import type { Project } from "../../../logic/project-manager.svelte";
import { checkpointStore } from "../../../store/checkpoint-store.svelte.js";
import { getAgentStore } from "../../../store/index.js";
import { getConnectionStore } from "../../../store/connection-store.svelte.js";
import { getInteractionStore } from "../../../store/interaction-store.svelte.js";
import { getPanelStore } from "../../../store/panel-store.svelte.js";
import { getPermissionStore } from "../../../store/permission-store.svelte.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import { getChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import { mergeStrategyStore } from "../../../store/merge-strategy-store.svelte.js";
import { sessionReviewStateStore } from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { PanelConnectionEvent } from "../../../types/panel-connection-state.js";
import { PanelConnectionState } from "../../../types/panel-connection-state.js";
import type { WorktreeInfo } from "../../../types/worktree-info.js";
import { computeStatsFromCheckpoints } from "../../../utils/checkpoint-diff-utils.js";
import { Colors, getProjectColor, TAG_COLORS } from "@acepe/ui/colors";
import { createLogger } from "../../../utils/logger.js";
import AgentInput from "../../agent-input/agent-input-ui.svelte";
import AgentSelector from "../../agent-selector.svelte";
import BranchPicker from "../../branch-picker/branch-picker.svelte";
import ProjectSelector from "../../project-selector.svelte";
import {
	createDelayedBranchMetadataScheduler,
	createEmptyStateBranchMetadataLoader,
	type EmptyStateBranchMetadataRefreshOptions,
} from "../../../../components/main-app-view/components/content/logic/empty-state-branch-metadata-loader.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { Attachment } from "../../agent-input/types/attachment.js";
import { CheckpointTimeline } from "../../checkpoint/index.js";
import type { PrGenerationConfig } from "../../modified-files/types/pr-generation-config.js";
import * as agentModelPrefs from "../../../store/agent-model-preferences-store.svelte.js";
import {
	AgentPanelComposerFrame as SharedAgentPanelComposerFrame,
	AgentPanelPlanHeader as SharedPlanHeader,
	AgentPanelTranscriptScrollControls as SharedAgentPanelTranscriptScrollControls,
} from "@acepe/ui/agent-panel";
import PlanDialog from "../../plan-dialog.svelte";
import { getMessageQueueStore } from "../../../store/message-queue/message-queue-store.svelte.js";
import { getTodoStateManager } from "../../../logic/todo-state-manager.svelte.js";
import { usePlanLoader } from "../hooks";
import {
	createWorktreeSetupMatchContext,
	copyTextToClipboard,
	matchesWorktreeSetupContext,
	resolveEffectiveProjectPath,
	resolvePlanningPlaceholderPresentation,
	shouldShowInlinePanelError,
	shouldShowNewThreadSetupContext,
	shouldShowClaudeWorkingSpark,
} from "../logic";
import { DEFAULT_BROWSER_HOME_URL } from "../../../constants/browser-defaults.js";
import { getProviderBrandIcon } from "../../../constants/thread-list-constants.js";
import { createAgentPanelExportHandlers } from "../logic/agent-panel-export-handlers.js";
import { createAgentPanelInteractionHandlers } from "../logic/agent-panel-interaction-handlers.js";
import {
	ATTACHED_COLUMN_WIDTH,
	BROWSER_SIDEBAR_COLUMN_WIDTH,
	PLAN_SIDEBAR_COLUMN_WIDTH,
} from "../state/agent-panel-layout-controller.svelte.js";
import { shouldShowAgentPanelProjectSelection } from "../logic/project-selection-visibility.js";
import { AgentPanelRootState } from "../state/agent-panel-root-state.svelte.js";
import { shouldAutoScrollOnPanelActivation } from "../logic/should-auto-scroll-on-panel-activation.js";
import { isInteractiveClickTarget } from "../logic/panel-focus-guard.js";
import { deriveAgentPanelHeaderDisplayTitle } from "../logic/agent-panel-header-title.js";
import { resolveAgentPanelHeaderSequenceId } from "../logic/agent-panel-header-sequence-id.js";
import { resolveAgentPanelProviderBrand } from "../logic/agent-panel-provider-brand.js";
import { derivePendingUserRevealRequestKey } from "../logic/pending-user-reveal-request-key.js";
import { resolveWorktreeToggleProjectPath } from "../logic/worktree-toggle-project-path.js";
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree/worktree-default-store.svelte.js";
import type { AgentPanelProps } from "../types";
import { revealInFinder } from "$lib/utils/tauri-client/opener.js";
import type { OpenProjectFileSystemDialogOptions } from "../../../store/project-file-system-dialog-state.js";
import { resolveProjectFileReference } from "../../messages/logic/file-chip-diff-enhancer.js";
import AgentPanelContent from "./agent-panel-content.svelte";
import AgentPanelHeader from "./agent-panel-header.svelte";
import AgentPanelResizeEdge from "./agent-panel-resize-edge.svelte";
import AgentPanelReviewWorkspace from "./agent-panel-review-workspace.svelte";
import type { ReviewControlsSnapshot } from "./agent-panel-review-content-types.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { AlertDialog } from "bits-ui";
import AgentPanelTerminalDrawer from "./agent-panel-terminal-drawer.svelte";
import AgentPanelPreComposerStack from "./agent-panel-pre-composer-stack.svelte";
import { PlanSidebar } from "../../plan-sidebar/index.js";
import { BrowserPanel as BrowserPanelComponent } from "../../browser-panel/index.js";
import { AgentPanelTrailingPaneLayout } from "@acepe/ui/agent-panel";
import { buildAgentErrorIssueDraft } from "../logic/issue-report-draft.js";
import { resolveInitialReviewWorkspaceIndex } from "./review-workspace-model.js";
import {
	cancelQueuedMessageAndRestoreInput,
	clearMessageQueue,
	removeAttachmentFromQueuedMessage,
	sendQueuedMessageNow,
} from "../logic/queue-strip-handlers.js";
import {
	fetchPanelGitBranch,
	fetchWorktreePathListedForProject,
	runCreatePrWorkflow,
	runMergePrWorkflow,
	runPanelConnectionRetry,
	scheduleCheckpointReloadAfterRevert,
	subscribeGitWorktreeSetupChannel,
} from "../services/index.js";
import { recordPanelOpenPerformanceMark } from "../logic/panel-open-performance-mark.js";
import {
	shouldDeferInitialComposerMountWork,
	shouldWaitForInitialTranscriptRowsBeforeComposer,
} from "../../agent-input/services/index.js";

// Canonical-to-presentation turn state mapping is provided by the shared logic module
// (mapCanonicalTurnStateToPresentationStatus) imported above.

// ✅ Destructure props - this is idiomatic Svelte 5
let {
	panelId,
	sessionId = null,
	width,
	pendingProjectSelection,
	isWaitingForSession = false,
	projectCount,
	allProjects,
	project,
	selectedAgentId,
	availableAgents,
	onAgentChange,
	effectiveTheme,
	onClose,
	onCreateSessionForProject,
	onSessionCreated,
	onResizePanel,
	onToggleFullscreen,
	isFullscreen = false,
	isFocused = false,
	hideProjectBadge = false,
	onFocus,
	hasAttachedFilePane = false,
	onCreateIssueReport,
}: AgentPanelProps = $props();

// svelte-ignore state_referenced_locally -- constructor timing should use this instance's initial panel id.
recordPanelOpenPerformanceMark(panelId, "agent-panel:props");

const logger = createLogger({ id: "agent-panel-render-trace", name: "AgentPanelRenderTrace" });
let lastPanelTraceSignature = $state<string | null>(null);
let prefersReducedMotion = $state(false);
const DEFERRED_COMPOSER_FALLBACK_MS = 250;

function isAgentPanelRenderTraceEnabled(): boolean {
	return (
		import.meta.env.DEV &&
		typeof localStorage !== "undefined" &&
		localStorage.getItem("acepe.agentPanelRenderTrace") === "true"
	);
}

// svelte-ignore state_referenced_locally -- constructor timing should use this instance's initial panel id.
recordPanelOpenPerformanceMark(panelId, "agent-panel:root-state-start");
const rootState = new AgentPanelRootState({
	stores: {
		sessionStore: getSessionStore(),
		panelStore: getPanelStore(),
		chatPreferencesStore: getChatPreferencesStore() ?? null,
		connectionStore: getConnectionStore(),
		interactionStore: getInteractionStore(),
		permissionStore: getPermissionStore(),
		agentStore: getAgentStore(),
		messageQueueStore: getMessageQueueStore(),
	},
	getPanelId: () => panelId,
	getSessionId: () => sessionId,
	getPanelWidth: () => width,
	getHasAttachedFilePane: () => hasAttachedFilePane,
	getIsFullscreen: () => isFullscreen,
	getHasPlan: () => planState.plan !== null,
	getAgentName: () => agentName,
	getViewStateInput: (state) => ({
		lifecyclePresentation: state.sessionController.lifecyclePresentation,
		entriesCount: state.sessionController.knownVisibleEntryCount,
		hasSession: sessionId !== null,
		isAwaitingModelResponse: state.sessionController.isAwaitingModelResponse,
		hasImmediatePendingSendIntent: state.sessionController.hasImmediatePendingSendIntent,
		showProjectSelection,
		hasEffectiveProjectPath: !!effectiveProjectPath,
		errorInfo: state.sessionController.errorInfo,
	}),
	getGraphMaterializerInput: (state) => ({
		panelId: state.sessionController.effectivePanelId,
		graph: state.sessionController.agentPanelCanonicalSource,
		header: {
			title: graphHeaderTitle,
			subtitle: state.sessionController.sessionTitle,
			agentIconSrc,
			agentLabel: agentName,
			projectLabel: displayProjectName,
			projectColor,
			sequenceId,
		},
		optimistic:
			state.sessionController.optimisticUserEntryForGraph != null
				? {
						pendingUserEntry: state.sessionController.optimisticUserEntryForGraph,
					}
				: null,
	}),
	getPrefersReducedMotion: () => prefersReducedMotion,
	getWorktreeToggleProjectPath: () => worktreeToggleProjectPath,
	getPanelPendingWorktreeEnabled: () => panelPendingWorktreeEnabled,
	getPanelPreparedWorktreeLaunch: () => panelPreparedWorktreeLaunch,
	getPendingWorktreeSetup: (state) =>
		state.sessionController.panelHotState?.pendingWorktreeSetup ?? null,
	getPendingProjectSelection: () => pendingProjectSelection,
	getAllProjects: () => allProjects,
	logWorktreeCreated: (details) => {
		logger.info("[worktree-flow] handleWorktreeCreated: entry", details);
	},
	logWorktreeCreatedEarlyReturn: () => {
		logger.info("[worktree-flow] handleWorktreeCreated: early return (no projectPath)");
	},
});
// svelte-ignore state_referenced_locally -- constructor timing should use this instance's initial panel id.
recordPanelOpenPerformanceMark(panelId, "agent-panel:root-state-end");

const sessionStore = rootState.sessionStore;
const panelStore = rootState.panelStore;
const chatPreferencesStore = rootState.chatPreferencesStore;
const connectionStore = rootState.connectionStore;
const interactionStore = rootState.interactionStore;
const permissionStore = rootState.permissionStore;
const agentStore = rootState.agentStore;
const messageQueueStore = rootState.messageQueueStore;
const sessionController = rootState.sessionController;
const connection = rootState.connection;
const panelState = rootState.panelState;
const panelBranchLookup = rootState.panelBranchLookup;
const layoutController = rootState.layoutController;
const contentScrollReveal = rootState.contentScrollReveal;
const checkpointTimeline = rootState.checkpointTimeline;
const worktreeSetup = rootState.worktreeSetup;
const worktreeController = rootState.worktreeController;
const worktreeDefaultStore = getWorktreeDefaultStore();
const viewStateController = rootState.viewStateController;
const scenePipelineController = rootState.scenePipelineController;
const prCard = rootState.prCard;
const reviewDialog = rootState.reviewDialog;

// Filename pending revert confirmation in the review modal (null = closed).
let reviewRevertConfirmFileName = $state<string | null>(null);
let isUnarchivingSession = $state(false);
let isSigningIn = $state(false);
let signInError = $state<string | null>(null);
let signInAttempt = 0;

function keepReviewDiffSettingsMenuOpen(event: Event): void {
	event.preventDefault();
}

function handleReviewDiffStyleChange(value: string): void {
	if (value === "unified" || value === "split") {
		reviewDialog.setDiffStyle(value);
	}
}

function handleReviewDiffIndicatorStyleChange(value: string): void {
	if (value === "bars" || value === "classic" || value === "none") {
		reviewDialog.setDiffIndicatorStyle(value);
	}
}

function handleReviewDiffLineChangeStyleChange(value: string): void {
	if (value === "none" || value === "word" || value === "character") {
		reviewDialog.setDiffLineChangeStyle(value);
	}
}

setThinkingPreferences({
	get defaultExpanded() {
		return chatPreferencesStore ? !chatPreferencesStore.thinkingBlockCollapsedByDefault : false;
	},
	onToggleDefaultExpand: () => {
		chatPreferencesStore?.setThinkingBlockCollapsedByDefault(
			!chatPreferencesStore.thinkingBlockCollapsedByDefault
		);
	},
});

onMount(() => {
	const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
	if (mediaQuery === null) {
		prefersReducedMotion = false;
		return;
	}
	const updateReducedMotion = (event: MediaQueryList | MediaQueryListEvent): void => {
		prefersReducedMotion = event.matches;
	};
	updateReducedMotion(mediaQuery);
	mediaQuery.addEventListener("change", updateReducedMotion);
	return () => {
		mediaQuery.removeEventListener("change", updateReducedMotion);
	};
});

// ============================================================
// GRANULAR SESSION DATA - Fine-grained reactivity
// Each accessor only triggers re-renders when ITS data changes
// ============================================================

// Identity & metadata now live on the session controller (single source +
// unit-tested); these stay as thin reactive aliases so existing read sites are
// unchanged. Ref-inlining to `sessionController.*` is deferred to the final sweep.
// Entry-presence + canonical session-status derivations now live on the
// session controller (single source + unit-tested); these stay as thin
// reactive aliases. Ref-inlining to sessionController.* is deferred to U5.
const panelSnapshot = $derived(panelId ? panelStore.getTopLevelPanel(panelId) : null);
const panelPendingWorktreeEnabled = $derived(
	panelSnapshot?.kind === "agent" ? (panelSnapshot.pendingWorktreeEnabled ?? null) : null
);
const panelPreparedWorktreeLaunch = $derived(
	panelSnapshot?.kind === "agent" ? (panelSnapshot.preparedWorktreeLaunch ?? null) : null
);

let inlinePlanDialogPlan = $state<{ title: string; content: string; summary: null } | null>(null);

// ✅ Hooks at component level (they need prop reactivity)
// Pass granular identity data instead of full session object
const planState = usePlanLoader(() =>
	sessionId && sessionController.sessionProjectPath && sessionController.sessionAgentId
		? {
				id: sessionId,
				projectPath: sessionController.sessionProjectPath,
				agentId: sessionController.sessionAgentId,
			}
		: null
);

// Simple scroll container binding (updated via bind:)
let scrollContainer: HTMLDivElement | null = $state(null);

// Reference to content component for scroll control
let contentRef: AgentPanelContent | null = $state(null);

// Scroll viewport reference for scroll-to-bottom button (bindable from child)
let contentScrollViewport: HTMLElement | null = $state(null);

let _panelBranch = $state<string | null>(null);
let preSessionCurrentBranch = $state<string | null>(null);
let preSessionDiffStats = $state<{ insertions: number; deletions: number } | null>(null);
let preSessionIsGitRepo = $state<boolean | null>(null);
const preSessionBranchMetadataLoader = createEmptyStateBranchMetadataLoader({
	gitClient: tauriClient.git,
	scheduler: createDelayedBranchMetadataScheduler(),
	writer: {
		reset() {
			preSessionCurrentBranch = null;
			preSessionDiffStats = null;
			preSessionIsGitRepo = null;
		},
		setIsGitRepo(value) {
			preSessionIsGitRepo = value;
		},
		setCurrentBranch(value) {
			preSessionCurrentBranch = value;
		},
		setDiffStats(value) {
			preSessionDiffStats = value;
		},
	},
});
let branchRequestVersion = 0;

function refreshPreSessionBranchMetadata(
	targetProjectPath: string,
	options?: EmptyStateBranchMetadataRefreshOptions
): void {
	preSessionBranchMetadataLoader.refresh(targetProjectPath, options);
}

function scheduleAfterPanelPaint(callback: () => void): () => void {
	let cancelled = false;
	let firstFrame: number | null = null;
	let secondFrame: number | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
	const run = () => {
		if (cancelled) {
			return;
		}
		if (fallbackTimer !== null) {
			clearTimeout(fallbackTimer);
			fallbackTimer = null;
		}
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		callback();
	};
	const scheduleTimer = () => {
		if (cancelled) {
			return;
		}
		timer = setTimeout(run, 0);
	};
	if (typeof requestAnimationFrame !== "function") {
		timer = setTimeout(run, 0);
	} else {
		fallbackTimer = setTimeout(run, DEFERRED_COMPOSER_FALLBACK_MS);
		firstFrame = requestAnimationFrame(() => {
			firstFrame = null;
			if (cancelled) {
				return;
			}
			secondFrame = requestAnimationFrame(() => {
				secondFrame = null;
				scheduleTimer();
			});
		});
	}
	return () => {
		cancelled = true;
		if (firstFrame !== null) {
			cancelAnimationFrame(firstFrame);
		}
		if (secondFrame !== null) {
			cancelAnimationFrame(secondFrame);
		}
		if (timer !== null) {
			clearTimeout(timer);
		}
		if (fallbackTimer !== null) {
			clearTimeout(fallbackTimer);
		}
	};
}

function scrollToTop() {
	contentRef?.scrollToTop();
}

function scrollToBottom() {
	// Force: true when user clicks the button - clears anchor
	contentRef?.scrollToBottom({ force: true });
}

function prepareForNextUserReveal() {
	const requestVersion = contentScrollReveal.requestUserReveal();
	logger.info("prepareForNextUserReveal: panel", {
		panelId: sessionController.effectivePanelId,
		sessionId,
		entryCount: sessionController.visibleEntryCount,
		requestVersion,
	});
	return sessionController.effectivePanelId;
}

function scrollToBottomOnTabSwitch() {
	// Returning to the panel resumes live follow for that thread.
	contentRef?.scrollToBottom({ force: true });
}

// Effective panel ID (use prop or generate one)
const pendingUserRevealRequestKey = $derived(
	derivePendingUserRevealRequestKey({
		panelId: sessionController.effectivePanelId,
		userRevealRequestVersion: contentScrollReveal.userRevealRequestVersion,
	})
);

// Derived UI conditions based on projectCount + panel/session state
const showProjectSelection = $derived(
	shouldShowAgentPanelProjectSelection({
		sessionId,
		projectCount,
		pendingProjectSelection,
		projectKnown: project !== null,
	})
);
const worktreeToggleProjectPath = $derived(
	resolveWorktreeToggleProjectPath({
		hasSession: sessionId !== null,
		sessionProjectPath: sessionController.sessionProjectPath,
		selectedProjectPath: project?.path ?? null,
		singleProjectPath: projectCount === 1 ? (allProjects[0]?.path ?? null) : null,
	})
);
const activeWorktreePath = $derived(worktreeController.activeWorktreePath);
const activeWorktreeOwnerProjectPath = $derived(worktreeController.activeWorktreeOwnerProjectPath);
const scopedActiveWorktreePath = $derived(worktreeController.scopedActiveWorktreePath);
const effectiveActiveWorktreePath = $derived(worktreeController.effectiveActiveWorktreePath);
const worktreeDeleted = $derived(worktreeController.worktreeDeleted);
const effectivePathForGit = $derived(worktreeController.effectivePathForGit);

const showPlanSidebar = $derived(layoutController.showPlanSidebar);
const isTerminalDrawerOpen = $derived(layoutController.isTerminalDrawerOpen);
const showBrowserSidebar = $derived(layoutController.showBrowserSidebar);
const browserSidebarUrl = $derived(layoutController.browserSidebarUrl);
// Canonical lifecycle presentation from Rust-owned graph projection.
const entriesCount = $derived(sessionController.knownVisibleEntryCount);
const hasSession = $derived(sessionId !== null);
// Prefer active worktree path, then session worktree, then project paths.
// NOTE: Must be defined before panelVisibility which uses effectiveProjectPath
// When the worktree has been deleted, skip worktree paths so git commands
// target the original project root instead of a non-existent directory.
const effectiveProjectPath = $derived(
	resolveEffectiveProjectPath({
		activeWorktreePath: worktreeDeleted ? null : scopedActiveWorktreePath,
		sessionWorktreePath: worktreeDeleted ? null : sessionController.sessionWorktreePath,
		sessionProjectPath: sessionController.sessionProjectPath,
		selectedProjectPath: project?.path,
		singleProjectPath: projectCount === 1 ? allProjects[0].path : undefined,
	})
);
const effectiveProjectName = $derived(
	sessionController.sessionProjectPath
		? project?.name
		: (project?.name ?? (projectCount === 1 ? allProjects[0].name : undefined))
);
const preSessionSelectedProject = $derived(worktreeController.preSessionSelectedProject);

// ✅ Derived values from granular session data
const effectivePanelAgentId = $derived(selectedAgentId ?? sessionController.sessionAgentId);
// Claude is the only agent with a bespoke working spark; the transcript's planning
// placeholder swaps it in for the label while streaming (gated on canonical agentId).
const showWorkingSpark = $derived(
	shouldShowClaudeWorkingSpark({
		sessionAgentId: sessionController.sessionAgentId,
		selectedAgentId,
	})
);
const agentName = $derived.by(() => {
	if (!effectivePanelAgentId) {
		return null;
	}

	const agent = availableAgents.find((candidate) => candidate.id === effectivePanelAgentId);
	return agent?.name ?? effectivePanelAgentId;
});
// Error/connection derivations now live on the session controller (single
// source + unit-tested); the connection $state + retry/cancel/dismiss handlers
// stay here (tangled with agentInputRef). Thin reactive aliases; ref-inline U5.
const errorDismissed = $derived(
	sessionController.errorDismissalKey !== null &&
		connection.dismissedErrorKey === sessionController.errorDismissalKey
);

const viewState = $derived(viewStateController.viewState);
const panelViewKind = $derived(viewStateController.panelViewKind);

// Suppress the inline error card when the big-page error variant is
// rendering for the same failure — otherwise the user sees the duplicated
// "Unable to load session" page AND a red inline card. The big page is
// the primary treatment when there are no entries; the inline card is
// the single surface inside an active conversation.
const showInlineErrorCard = $derived(
	shouldShowInlinePanelError({
		showError: sessionController.errorInfo.showError,
		errorDismissed,
		viewKind: viewState.kind,
		hasTranscript: sessionController.hasMessages,
	})
);
const worktreePending = $derived(worktreeController.worktreePending);
const pendingWorktreeSetup = $derived(
	sessionController.panelHotState ? sessionController.panelHotState.pendingWorktreeSetup : null
);
const showPreSessionWorktreeCard = $derived(worktreeController.showPreSessionWorktreeCard);
const showNewThreadSetupContext = $derived(
	shouldShowNewThreadSetupContext({
		hasSession,
		hasImmediatePendingSendIntent: sessionController.hasImmediatePendingSendIntent,
		hasMessages: sessionController.hasMessages,
	})
);

$effect(() => {
	if (!isAgentPanelRenderTraceEnabled()) return;
	logger.info("[first-send-trace] panel render gate", {
		panelId: sessionController.effectivePanelId,
		sessionId: sessionId ?? null,
		viewState: viewState.kind,
		pendingUserEntry: panelId ? panelStore.getHotState(panelId).pendingUserEntry !== null : false,
		entriesCount: sessionController.knownVisibleEntryCount,
		hasSession: sessionId !== null,
		t_ms: Math.round(performance.now()),
	});
});

$effect(() => {
	if (!isAgentPanelRenderTraceEnabled()) return;
	const signature = JSON.stringify({
		panelId,
		sessionId,
		viewState: viewState.kind,
		entryCount: sessionController.visibleEntryCount,
	});
	if (signature === lastPanelTraceSignature) {
		return;
	}
	lastPanelTraceSignature = signature;
	logger.info("agent panel state changed", JSON.parse(signature) as object);
});

$effect(() => {
	if (!isAgentPanelRenderTraceEnabled()) return;
	logger.info("[worktree-flow] viewState changed", {
		kind: viewState.kind,
		showProjectSelection,
		projectPath: project?.path ?? null,
		projectCount,
		pendingProjectSelection,
		projectIsNull: project === null,
	});
});

$effect(() => {
	if (!isAgentPanelRenderTraceEnabled()) return;
	logger.info("[worktree-flow] worktree path chain", {
		activeWorktreePath,
		worktreeToggleProjectPath,
		activeWorktreeOwnerProjectPath,
		scopedActiveWorktreePath,
		sessionWorktreePath: sessionController.sessionWorktreePath,
		effectiveActiveWorktreePath,
		footerVisible: !!worktreeToggleProjectPath,
	});
});

$effect(() => {
	const pendingSetup = pendingWorktreeSetup;
	if (!pendingSetup) {
		return;
	}

	if (pendingSetup.phase === "creating-worktree") {
		worktreeSetup.startCreation({
			projectPath: pendingSetup.projectPath,
			worktreePath: pendingSetup.worktreePath,
		});
	}
	// "running" phase: don't pre-show the card — let the Tauri "started" event drive visibility.
	// If there are no setup commands, no event fires and the card correctly stays hidden.
});

$effect(() => {
	const projectPaths = worktreeSetupMatchContext.projectPaths;
	const worktreePaths = worktreeSetupMatchContext.worktreePaths;
	if (projectPaths.length === 0 && worktreePaths.length === 0) {
		return;
	}

	let unlisten: (() => void) | null = null;
	void subscribeGitWorktreeSetupChannel((payload) => {
		if (
			!matchesWorktreeSetupContext(payload, {
				projectPaths,
				worktreePaths,
			})
		) {
			return;
		}

		if (panelId) {
			panelStore.clearPendingWorktreeSetup(panelId);
		}
		worktreeSetup.applyEvent(payload);
	})
		.then((callback) => {
			unlisten = callback;
		})
		.catch((error) => {
			logger.warn("Failed to subscribe to worktree setup events", { error });
		});

	return () => {
		unlisten?.();
	};
});

$effect(() => {
	const state = worktreeSetup.state;
	if (!state) return;

	if (worktreeSetupMatchContext.worktreePaths.length > 0) {
		if (
			!state.worktreePath ||
			!worktreeSetupMatchContext.worktreePaths.includes(state.worktreePath)
		) {
			worktreeSetup.clear();
			if (panelId) {
				panelStore.clearPendingWorktreeSetup(panelId);
			}
		}
		return;
	}

	if (
		worktreeSetupMatchContext.projectPaths.length > 0 &&
		!worktreeSetupMatchContext.projectPaths.includes(state.projectPath)
	) {
		worktreeSetup.clear();
		if (panelId) {
			panelStore.clearPendingWorktreeSetup(panelId);
		}
	}
});

const projectColor = $derived.by(() => {
	return project ? getProjectColor(project) : (TAG_COLORS[0] ?? "#FF5D5A");
});
const projectIconSrc = $derived(project?.iconPath ?? null);

const displayProjectName = $derived.by(() => {
	return effectiveProjectName ?? "Project";
});

const sequenceId = $derived.by(() => {
	const id = sessionId;
	if (id === null) {
		return null;
	}
	const pendingCreation = sessionStore.getPendingCreationSession(id);
	return resolveAgentPanelHeaderSequenceId({
		sessionMetadataSequenceId: sessionController.sessionMetadata?.sequenceId,
		pendingCreationSequenceId: pendingCreation?.sequenceId ?? null,
		hasPendingCreationSession: sessionStore.hasPendingCreationSession(id),
	});
});

const displayTitle = $derived.by(() => {
	return deriveAgentPanelHeaderDisplayTitle({
		// Optimistic title (pending first user message) covers the whole
		// pre-canonical window so the header reads the message from t=0 without
		// reverting to "Conversation in <project>"; it self-defers to a real
		// canonical title, so canonical still wins once promoted.
		sessionTitle: sessionController.optimisticHeaderTitle ?? sessionController.sessionTitle,
		projectName: displayProjectName,
	});
});
const graphHeaderTitle = $derived(displayTitle ?? "");
const sessionDiffStats = $derived.by(() => {
	if (!sessionId) return { insertions: 0, deletions: 0 };
	const checkpoints = checkpointStore.getCheckpoints(sessionId);
	const stats = computeStatsFromCheckpoints(checkpoints);
	return stats ?? { insertions: 0, deletions: 0 };
});
const sessionCreatedAt = $derived(sessionController.sessionMetadata?.createdAt ?? null);
const sessionUpdatedAt = $derived(sessionController.sessionMetadata?.updatedAt ?? null);
const effectivePanelProviderBrand = $derived.by(() => {
	const headerAgentId = sessionController.sessionAgentId ?? effectivePanelAgentId;
	if (!headerAgentId) {
		return null;
	}

	const sessionProviderBrand =
		sessionId === null
			? null
			: (sessionStore.read.getSessionProviderMetadata(sessionId)?.providerBrand ?? null);
	const storeProviderBrand = agentStore.getProviderMetadata(headerAgentId)?.providerBrand ?? null;
	const listedProviderBrand =
		availableAgents.find((agent) => agent.id === headerAgentId)?.provider_metadata?.providerBrand ??
		null;

	return resolveAgentPanelProviderBrand({
		agentId: headerAgentId,
		sessionProviderBrand,
		storeProviderBrand,
		listedProviderBrand,
	});
});
const agentIconSrc = $derived(getProviderBrandIcon(effectivePanelProviderBrand, effectiveTheme));
const planningPlaceholderPresentation = $derived(
	resolvePlanningPlaceholderPresentation({
		agentName,
		agentIconSrc,
		showWorkingSpark,
	})
);
const graphMaterializedScene = $derived(scenePipelineController.graphMaterializedScene);
const graphSceneEntries = $derived(scenePipelineController.graphSceneEntries);
const tokenRevealSceneEntries = $derived(scenePipelineController.tokenRevealSceneEntries);
const tokenRevealSettleDelayMs = $derived(scenePipelineController.tokenRevealSettleDelayMs);
$effect(() => {
	const delayMs = tokenRevealSettleDelayMs;
	if (delayMs === null) {
		return;
	}

	const nextRevision = contentScrollReveal.settleRevision + 1;
	const timeoutId = window.setTimeout(() => {
		if (contentScrollReveal.settleRevision < nextRevision) {
			contentScrollReveal.setSettleRevision(nextRevision);
		}
	}, delayMs);

	return () => {
		window.clearTimeout(timeoutId);
	};
});
const isConnecting = $derived(
	connection.state === PanelConnectionState.CONNECTING ||
		(!sessionId && panelId ? sessionController.panelHotState?.pendingUserEntry !== null : false)
);
const inputRenderKey = $derived(
	`${panelId ?? "no-panel"}:${sessionController.panelHotState?.composerRestoreVersion ?? 0}`
);
const deferInitialComposerMountWork = $derived(
	shouldDeferInitialComposerMountWork({
		sessionId,
		viewKind: viewState.kind,
		visibleEntryCount: sessionController.knownVisibleEntryCount,
		sessionCanSubmit: sessionController.sessionCanSubmit,
	})
);
const renderedTranscriptRowCountForComposer = $derived.by(() => {
	if (sessionId === null) {
		return 0;
	}
	const rowsProjection = sessionStore.viewport.getRowsProjection(sessionId);
	if (rowsProjection?.sessionId !== sessionId) {
		return 0;
	}
	return rowsProjection.rows.length;
});
const waitForInitialTranscriptRowsBeforeComposer = $derived(
	shouldWaitForInitialTranscriptRowsBeforeComposer({
		sessionId,
		deferInitialComposerMountWork,
		visibleEntryCount: sessionController.knownVisibleEntryCount,
		renderedRowCount: renderedTranscriptRowCountForComposer,
	})
);
let deferredComposerMountKey = $state<string | null>(null);
let deferredComposerFallbackReadyKey = $state<string | null>(null);
let recordedDeferredComposerMountKey = $state<string | null>(null);
const renderDeferredOpenChrome = $derived(
	!deferInitialComposerMountWork || deferredComposerMountKey === inputRenderKey
);
const renderComposerInput = $derived(
	renderDeferredOpenChrome
);
const branchLookupPath = $derived(
	(worktreeDeleted ? null : effectiveActiveWorktreePath) ?? effectiveProjectPath ?? null
);
const footerWorktreeStatus = $derived(worktreeController.footerWorktreeStatus);

const hasPlan = $derived(planState.plan !== null);
const preSessionWorktreeFailure = $derived(worktreeController.preSessionWorktreeFailure);
let agentInputRef = $state<{
	retrySend: () => void;
	restoreQueuedMessage: (draft: string, attachments: readonly Attachment[]) => void;
} | null>(null);

onDestroy(() => {
	rootState.dispose();
});

const worktreeSetupMatchContext = $derived.by(() => {
	const activeSetupState = worktreeSetup.state?.isVisible ? worktreeSetup.state : null;

	return createWorktreeSetupMatchContext({
		pendingSetupProjectPath: pendingWorktreeSetup ? pendingWorktreeSetup.projectPath : null,
		pendingSetupWorktreePath: pendingWorktreeSetup ? pendingWorktreeSetup.worktreePath : null,
		currentSetupProjectPath: activeSetupState ? activeSetupState.projectPath : null,
		currentSetupWorktreePath: activeSetupState ? activeSetupState.worktreePath : null,
	});
});
/** Derived: is the selected agent currently being installed? */
const agentInstallState = $derived.by(() => {
	if (!effectivePanelAgentId) return null;
	const progress = agentStore.installing[effectivePanelAgentId];
	if (!progress) return null;
	const agent = availableAgents.find((a) => a.id === effectivePanelAgentId);
	return {
		agentId: effectivePanelAgentId,
		agentName: agent?.name ?? effectivePanelAgentId,
		stage: progress.stage,
		progress: progress.progress,
	};
});

// Derived from session store — populated from DB on startup, updated in-session after PR creation
// Also auto-populated when Claude creates a PR autonomously.
const createdPr = $derived(sessionController.sessionMetadata?.prNumber ?? null);

const prFetchTarget = $derived.by(() => {
	if (!sessionId || !sessionController.sessionProjectPath || createdPr == null) {
		return null;
	}

	return {
		sessionId,
		projectPath: sessionController.sessionProjectPath,
		prNumber: createdPr,
	};
});

mergeStrategyStore.scheduleInitialize();

/**
 * Fetch PR details from GitHub. Called imperatively:
 * - When the current session exposes a PR number
 * - After PR creation succeeds
 * - After PR merge (to refresh state)
 * The store's prState update is handled by sessionStore.connection.refreshSessionPrState.
 */
function fetchPrDetails(target: {
	sessionId: string;
	projectPath: string;
	prNumber: number;
}): void {
	prCard.resetDetails();
	void sessionStore.connection
		.refreshSessionPrState(target.sessionId, target.projectPath, target.prNumber)
		.match(
			(details) => {
				prCard.setDetails(details);
			},
			() => {
				// refreshSessionPrState never errors (orElse swallows), but match requires both branches
			}
		);
}

$effect(() => {
	prCard.syncFetchTarget(prFetchTarget, fetchPrDetails);
});

const hasAttachedPane = $derived(layoutController.hasAttachedPane);
const centeredFullscreenContent = $derived(layoutController.centeredFullscreenContent);
const agentContentColumnStyle = $derived(layoutController.agentContentColumnStyle);

const effectiveWidth = $derived(layoutController.effectiveWidth);
const widthStyle = $derived(layoutController.widthStyle);

// Pure derivation of modified files from canonical operations.
//
// Previously computed via `$effect` + `setTimeout(0)` to defer aggregation
// off the current reactive cascade. That pattern had two problems:
//   1. It violates the project rule against `$effect` + `$state` writes
//      for computed values.
//   2. On any upstream re-render (e.g. a sibling panel closing rebuilds
//      `panelsWithState`), the effect's cleanup cleared the pending
//      `setTimeout` and re-scheduled a new one. While the timer was
//      pending, consumers of `modifiedFilesState` that depended on its
//      stable identity could observe a transient reset, producing a
//      visible flicker in `ModifiedFilesHeader` and the files list
//      across every sibling agent panel.
//
// Making this a `$derived` keeps the value synchronously consistent.
const modifiedFilesState = $derived.by<ModifiedFilesState | null>(() => {
	if (viewState.kind !== "conversation" || sessionId === null) {
		return null;
	}
	return sessionStore.read.getSessionModifiedFilesState(sessionId);
});

function handleReviewAction(_event: AgentPanelReviewActionEvent): void {
	if (modifiedFilesState === null) {
		return;
	}
	handleOpenReviewDialog(modifiedFilesState, 0);
}

function openReviewDialogAtInitialFile(filesState: ModifiedFilesState): void {
	reviewDialog.open(filesState, resolveInitialReviewWorkspaceIndex(filesState, sessionId));
}

function handleOpenReviewDialog(filesState: ModifiedFilesState, _fileIndex: number): void {
	if (!sessionId) {
		openReviewDialogAtInitialFile(filesState);
		return;
	}

	void sessionReviewStateStore.ensureLoadedAsync(sessionId).then(() => {
		openReviewDialogAtInitialFile(filesState);
	});
}

// Track panelId changes for tab switching detection
let lastPanelId = $state<string | undefined>(undefined);

// ✅ Effects for side effects - handle tab switching
$effect(() => {
	if (!contentRef || viewState.kind !== "conversation") return;

	const isTabSwitch = shouldAutoScrollOnPanelActivation({
		currentPanelId: panelId,
		previousPanelId: lastPanelId,
	});
	lastPanelId = panelId;

	// On tab switch, resume the live thread for the newly active panel.
	if (isTabSwitch) {
		tick().then(() => {
			scrollToBottomOnTabSwitch();
		});
	}
	// Auto-scroll is now handled by ResizeObserver in the scroll manager
	// No need to call autoScrollIfEnabled here - it would override viewport anchoring
});

$effect(() => {
	const key = inputRenderKey;
	if (!deferInitialComposerMountWork) {
		if (deferredComposerMountKey !== key) {
			deferredComposerMountKey = key;
		}
		return;
	}
	if (deferredComposerMountKey === key) {
		return;
	}
	if (recordedDeferredComposerMountKey !== key) {
		recordedDeferredComposerMountKey = key;
		recordPanelOpenPerformanceMark(panelId, "agent-panel:composer-mount-deferred");
	}
	if (
		waitForInitialTranscriptRowsBeforeComposer &&
		deferredComposerFallbackReadyKey !== key
	) {
		const timeoutId = window.setTimeout(() => {
			if (deferredComposerFallbackReadyKey === key || deferredComposerMountKey === key) {
				return;
			}
			deferredComposerFallbackReadyKey = key;
		}, DEFERRED_COMPOSER_FALLBACK_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}
	return scheduleAfterPanelPaint(() => {
		if (deferredComposerMountKey === key) {
			return;
		}
		deferredComposerMountKey = key;
		recordPanelOpenPerformanceMark(panelId, "agent-panel:composer-mount-ready");
	});
});

$effect(() => {
	const preSessionPath = !hasSession ? worktreeToggleProjectPath : null;
	if (preSessionPath === null) {
		preSessionBranchMetadataLoader.reset();
		return;
	}
	refreshPreSessionBranchMetadata(preSessionPath);
});

$effect(() => {
	const decision = panelBranchLookup.next({
		lookupPath: branchLookupPath,
		viewKind: panelViewKind,
	});

	if (decision.kind === "noop") {
		return;
	}

	branchRequestVersion += 1;
	const currentVersion = branchRequestVersion;

	if (decision.kind === "clear") {
		_panelBranch = null;
		return;
	}

	_panelBranch = null;

	return scheduleAfterPanelPaint(() => {
		if (currentVersion !== branchRequestVersion) {
			return;
		}
		void fetchPanelGitBranch(decision.path).match(
			(branch) => {
				if (currentVersion === branchRequestVersion) {
					_panelBranch = branch;
				}
			},
			() => {
				if (currentVersion === branchRequestVersion) {
					_panelBranch = null;
				}
			}
		);
	});
});

// Check if the session's worktree still exists on disk.
// If deleted, disconnect the session (agent can't work in a missing directory).
$effect(() => {
	const worktreePath = sessionController.sessionWorktreePath;
	const projectPath = sessionController.sessionProjectPath;
	const currentSessionId = sessionId;
	if (!worktreePath || !projectPath) {
		worktreeController.setWorktreeDeleted(false);
		return;
	}
	let disposed = false;
	void fetchWorktreePathListedForProject(projectPath, worktreePath).match(
		(listed) => {
			if (disposed) return;
			if (!listed) {
				worktreeController.setWorktreeDeleted(true);
				if (currentSessionId) {
					sessionStore.connection.disconnectSession(currentSessionId);
				}
			} else {
				worktreeController.setWorktreeDeleted(false);
			}
		},
		() => {
			if (disposed) return;
			worktreeController.setWorktreeDeleted(true);
			if (currentSessionId) {
				sessionStore.connection.disconnectSession(currentSessionId);
			}
		}
	);
	return () => {
		disposed = true;
	};
});

// ✅ Event handlers - can access current props directly

function handleProjectAgentSelected(project: Project, agentId: string) {
	onAgentChange?.(agentId);
	onCreateSessionForProject?.(project);
}

function handleProjectSelected(project: Project) {
	onCreateSessionForProject?.(project);
}

function handleComposerProjectSelected(project: Project) {
	if (panelId) {
		panelStore.setPanelProjectPath(panelId, project.path);
		panelStore.movePanelToFront(panelId);
		return;
	}
	handleProjectSelected(project);
}

function installAgentThenCreateSession(project: Project, agentId: string) {
	handleProjectAgentSelected(project, agentId);
}

function handleSessionCreated(sessionIdParam: string) {
	worktreeController.onSessionCreated();
	if (panelId) {
		panelStore.clearSignInRequirement(panelId);
	}
	onSessionCreated?.(sessionIdParam);
}

const handleWorktreeCreated = (info: WorktreeInfo | string) =>
	worktreeController.handleWorktreeCreated(info);
const handlePreparedWorktreeLaunch = (
	launch: import("$lib/acp/types/worktree-info.js").PreparedWorktreeLaunch
) => worktreeController.handlePreparedWorktreeLaunch(launch);
const handlePreSessionWorktreeFailure = (message: string) =>
	worktreeController.handlePreSessionWorktreeFailure(message);
const handleRetryWorktree = () => worktreeController.handleRetryWorktree(agentInputRef?.retrySend);
const handleStartInProjectRoot = () => worktreeController.handleStartInProjectRoot();
const handleWorktreeRenamed = (info: WorktreeInfo) =>
	worktreeController.handleWorktreeRenamed(info);

async function handleCreatePr(config?: PrGenerationConfig) {
	const path = effectivePathForGit;
	logger.info("handleCreatePr called", { path, sessionId, panelId, config });
	if (!path) {
		logger.warn("handleCreatePr: no effectivePathForGit, aborting");
		return;
	}
	await runCreatePrWorkflow({
		path,
		sessionId,
		modifiedFilesState,
		config,
		effectivePanelAgentId,
		setCreatePrRunning: (running) => prCard.setCreateRunning(running),
		setCreatePrLabel: (label) => prCard.setCreateLabel(label),
		onStreamReset: () => prCard.resetStream(),
		onStreamUpdate: (data) => prCard.applyStreamUpdate(data),
		deps: {
			applyAutomaticSessionPrLink: async (id, projectPath, pr) => {
				const result = await sessionStore.connection.applyAutomaticPrLinkFromShipWorkflow(
					id,
					projectPath,
					pr
				);
				return result.match(
					(prNumber) => prNumber,
					() => null
				);
			},
		},
	});
}

async function handleMergePr(strategy: MergeStrategy) {
	const path = effectivePathForGit;
	const prNum = createdPr;
	if (!path || prNum == null || !sessionId) return;
	await runMergePrWorkflow({
		path,
		prNum,
		strategy,
		setMergePrRunning: (running) => prCard.setMergeRunning(running),
		onMerged: () => {
			sessionStore.write.updateSession(sessionId, { prState: "MERGED" });
			sessionStore.connection.invalidatePrDetails(path, prNum);
			fetchPrDetails({
				sessionId,
				projectPath: path,
				prNumber: prNum,
			});
		},
	});
}

const {
	handleCopyContent,
	handleOpenInFinder,
	handleExportRawStreaming,
	handleCopyStreamingLogPath,
	handleOpenRawFile,
	handleOpenInAcepe,
	handleExportMarkdown,
	handleExportJson,
} = createAgentPanelExportHandlers({
	getSessionId: () => sessionId,
	getSessionProjectPath: () => sessionController.sessionProjectPath,
	getSessionAgentId: () => sessionController.sessionAgentId,
	getSessionSourcePath: () => sessionController.sessionMetadata?.sourcePath ?? null,
	getEffectivePanelId: () => sessionController.effectivePanelId,
	sessionStore,
	panelStore,
	logger,
});

function handleOpenWorktree(): void {
	const path = effectiveActiveWorktreePath;
	if (!path) {
		return;
	}

	void revealInFinder(path).match(
		() => {},
		(error) => {
			toast.error(`Could not reveal in Finder: ${error.message}`);
		}
	);
}

function handlePanelClick(e: MouseEvent) {
	const target = e.target as HTMLElement;

	// Don't focus the panel when clicking on form elements, buttons, or a
	// registered input area — see isInteractiveClickTarget for the rationale.
	if (isInteractiveClickTarget(target)) {
		return;
	}

	// Focus the panel when clicking anywhere else
	if (!isFocused) {
		onFocus?.();
	}
}

function handlePanelKeyDown(e: KeyboardEvent) {
	if (e.key === "Enter" || e.key === " ") {
		// For keyboard events, we don't need to check the target
		// since the panel itself has focus (not an input element)
		if (!isFocused) {
			onFocus?.();
		}
	}
}

function handleRetryConnection() {
	// beginRetry guards against re-entrancy and starts the 4s busy window; the
	// derived isRetrying also clears as soon as the failure state transitions
	// away — see Decision 7.
	if (!connection.beginRetry()) {
		return;
	}

	// Turn-level failure on an existing session: re-send the last user
	// message in the same session instead of recreating the session.
	// Recreating throws away the bound session and the user sees no change.
	const isTurnFailure =
		sessionId !== null &&
		(sessionController.activeTurnError !== null || sessionController.sessionTurnState === "error");
	if (isTurnFailure && agentInputRef) {
		agentInputRef.retrySend();
		return;
	}

	runPanelConnectionRetry({
		sessionId,
		panelId: panelId ?? undefined,
		panelConnectionState: connection.state,
		project,
		effectivePanelAgentId,
		onClearErrorDismissed: () => {
			connection.clearDismissedError();
		},
		onSendCancelToPanel: (id) => {
			connectionStore.send(id, { type: PanelConnectionEvent.CANCEL });
		},
		onRecreateSession: (proj, agentId) => {
			void installAgentThenCreateSession(proj, agentId);
		},
		logContext: {
			panelId: sessionController.effectivePanelId,
			projectPath: project?.path,
			agentId: effectivePanelAgentId,
		},
	});
}

function handleUnarchiveSession() {
	if (sessionId === null) {
		toast.error("No session selected to unarchive.");
		return;
	}
	if (isUnarchivingSession) {
		return;
	}

	isUnarchivingSession = true;
	void tauriClient.acp.unarchiveSession(sessionId).match(
		() => {
			isUnarchivingSession = false;
			toast.success("Session unarchived");
			connection.clearDismissedError();
			handleRetryConnection();
		},
		(error) => {
			isUnarchivingSession = false;
			toast.error(`Failed to unarchive session: ${error.message}`);
		}
	);
}

function handleCancelConnection() {
	// For now, just show a message that cancellation is not implemented
	// In the future, this could cancel any pending session creation
	toast.info("Connection cancellation not yet implemented.");
}

function handleDismissError() {
	const errorKey = sessionController.errorDismissalKey;
	if (errorKey !== null) {
		connection.dismissError(errorKey);
	}
}

function handleDismissSignIn() {
	if (panelId) {
		panelStore.clearSignInRequirement(panelId);
	}
}

function handleSignIn() {
	const agentId = effectivePanelAgentId;
	if (agentId === null || agentId === undefined || isSigningIn) {
		return;
	}

	const attempt = signInAttempt + 1;
	const panelIdAtStart = panelId;
	const sessionIdAtStart = sessionId;
	signInAttempt = attempt;
	isSigningIn = true;
	signInError = null;

	void tauriClient.acp.authenticateAgent(agentId).match(
		() => {
			if (
				signInAttempt !== attempt ||
				effectivePanelAgentId !== agentId ||
				panelId !== panelIdAtStart ||
				sessionController.signInRequirement === null
			) {
				if (signInAttempt === attempt) {
					isSigningIn = false;
				}
				return;
			}
			isSigningIn = false;
			signInError = null;
			if (sessionIdAtStart !== null) {
				void sessionStore.connection
					.connectSession(sessionIdAtStart, { forceReconnect: true })
					.match(
						() => undefined,
						(error) => {
							signInError = error.message;
						}
					);
				return;
			}
			if (panelIdAtStart) {
				panelStore.clearSignInRequirement(panelIdAtStart);
			}
			agentInputRef?.retrySend();
		},
		(error) => {
			if (signInAttempt !== attempt) {
				return;
			}
			isSigningIn = false;
			signInError = error.message;
		}
	);
}

function handleCancelSignIn() {
	const agentId = effectivePanelAgentId;
	if (agentId === null || agentId === undefined || !isSigningIn) {
		return;
	}
	void tauriClient.acp.cancelAgentAuthentication(agentId).match(
		() => undefined,
		(error) => {
			signInError = error.message;
		}
	);
}

function handleCopyInlineErrorReference() {
	const referenceId = sessionController.inlineErrorReferenceId;
	if (referenceId === null) {
		return;
	}

	void copyTextToClipboard(referenceId).match(
		() => {
			toast.success("Reference ID copied");
		},
		(error) => {
			toast.error(error.message);
		}
	);
}

function createInlineErrorIssueDraft() {
	const details =
		sessionController.errorInfo.details ??
		connection.error?.message ??
		sessionController.sessionConnectionError ??
		"Unknown error";
	const summary =
		sessionController.errorInfo.summary ?? details.split("\n")[0]?.slice(0, 120) ?? "Agent error";
	return buildAgentErrorIssueDraft({
		agentId: effectivePanelAgentId ?? "unknown",
		sessionId,
		projectPath: sessionController.sessionProjectPath,
		worktreePath: sessionController.sessionWorktreePath,
		errorSummary: summary,
		errorDetails: details,
		referenceId: sessionController.inlineErrorReferenceId,
		referenceSearchable: sessionController.inlineErrorReferenceSearchable,
		diagnosticsSummary: sessionController.errorInfo.summary,
		sessionTitle: sessionController.sessionTitle,
		sessionCreatedAt,
		sessionUpdatedAt,
		currentModelId: sessionController.sessionCurrentModelId,
		entryCount: sessionController.visibleEntryCount,
		panelConnectionState: connection.state?.toString() ?? null,
	});
}

const inlineErrorIssueDraft = $derived.by(() =>
	onCreateIssueReport ? createInlineErrorIssueDraft() : null
);

function handleIssueFromInlineError() {
	const draft = inlineErrorIssueDraft;
	if (draft === null) {
		return;
	}

	onCreateIssueReport?.(draft);
}

function handleCheckpointRevertComplete() {
	if (sessionId) {
		scheduleCheckpointReloadAfterRevert(sessionId);
	}
}

const todoManager = getTodoStateManager();
const todoState = $derived.by(() => {
	if (!sessionId) return null;
	const threadData = {
		toolCalls: sessionStore.read.getSessionToolCalls(sessionId),
		isConnected: sessionController.sessionIsConnected,
		status: sessionController.panelSessionStatus,
		isStreaming: sessionController.sessionIsStreaming,
	};
	const result = todoManager.getTodoStateFromToolCalls(sessionId, threadData);
	return result.isOk() ? result.value : null;
});
const showTodoHeader = $derived(todoState !== null && todoState.totalCount > 0);

const queueVersion = $derived.by(() => {
	if (!sessionId) return 0;
	const version = messageQueueStore.versions.get(sessionId);
	return version !== undefined ? version : 0;
});
const queueMessages = $derived.by(() => {
	if (!sessionId) return [];
	queueVersion;
	return messageQueueStore.getQueue(sessionId);
});
const queueIsPaused = $derived(sessionId ? messageQueueStore.pausedIds.has(sessionId) : false);

const queueStripDisplayMessages = $derived.by(() => {
	if (!sessionId) return [];
	return queueMessages.map((msg) => ({
		id: msg.id,
		content: msg.content,
		attachmentCount: msg.attachments.length,
		attachments: msg.attachments.map((a) => ({
			id: a.id,
			displayName: a.displayName,
			extension: a.extension || null,
			kind:
				a.type === "image"
					? ("image" as const)
					: a.type === "text"
						? ("other" as const)
						: ("file" as const),
		})),
	}));
});

const hasPreComposerStackContent = $derived(
	worktreeDeleted ||
		showInlineErrorCard ||
		(preSessionWorktreeFailure !== null && worktreeToggleProjectPath !== null) ||
		worktreeSetup.state?.isVisible === true ||
		agentInstallState !== null ||
		sessionId !== null ||
		(effectivePathForGit !== null &&
			(createdPr !== null || prCard.createRunning || prCard.streamingShipData !== null)) ||
		(showTodoHeader && todoState !== null) ||
		queueStripDisplayMessages.length > 0 ||
		sessionController.signInRequirement !== null
);

const handlePreSessionWorktreeYes = () => worktreeController.handlePreSessionWorktreeYes();
const handlePreSessionWorktreeNo = () => worktreeController.handlePreSessionWorktreeNo();
const handlePreSessionWorktreeDismiss = () => worktreeController.handlePreSessionWorktreeDismiss();

function handleQueueStripCancel(messageId: string): void {
	if (!sessionId || !agentInputRef) {
		return;
	}
	cancelQueuedMessageAndRestoreInput({
		sessionId,
		messageId,
		queueMessages,
		agentInputRef,
		messageQueueStore,
	});
}

function handleQueueStripRemoveAttachment(messageId: string, attachmentId: string): void {
	if (sessionId) {
		removeAttachmentFromQueuedMessage({
			sessionId,
			messageId,
			attachmentId,
			messageQueueStore,
		});
	}
}

function handleQueueStripClear(): void {
	if (sessionId) {
		clearMessageQueue({ sessionId, messageQueueStore });
	}
}

function handleQueueStripSendNow(messageId: string): void {
	if (sessionId) {
		sendQueuedMessageNow({ sessionId, messageId, messageQueueStore });
	}
}

const {
	handleQuestionSelect,
	handleToolFileSelect,
	handlePlanBuild,
	handlePlanCancel,
	isPlanActionAvailable,
} = createAgentPanelInteractionHandlers({
	getSessionId: () => sessionId,
	getEffectiveProjectPath: () => effectiveProjectPath ?? null,
	getSessionProjectPath: () => sessionController.sessionProjectPath,
	getEffectivePanelId: () => sessionController.effectivePanelId,
	sessionStore,
	permissionStore,
	panelStore,
});

function handleUserFileSelect(event: AgentUserFileSelectEvent): void {
	const targetProjectPath = effectiveProjectPath ?? sessionController.sessionProjectPath;
	if (targetProjectPath === null || targetProjectPath === undefined) {
		return;
	}

	const fileReference = resolveProjectFileReference(event.value, targetProjectPath);
	const dialogOptions: OpenProjectFileSystemDialogOptions = {};
	if (fileReference.targetLine !== undefined) {
		dialogOptions.targetLine = fileReference.targetLine;
	}
	if (fileReference.targetColumn !== undefined) {
		dialogOptions.targetColumn = fileReference.targetColumn;
	}
	panelStore.openProjectFileSystemDialog(targetProjectPath, fileReference.filePath, dialogOptions);
}

function handlePlanViewFull(event: AgentPanelPlanViewEvent): void {
	inlinePlanDialogPlan = {
		title: event.title,
		content: event.content,
		summary: null,
	};
}

function handleInlinePlanDialogOpenChange(open: boolean): void {
	if (open) {
		return;
	}
	inlinePlanDialogPlan = null;
}

async function handlePlanSidebarSendMessage(sid: string, message: string): Promise<void> {
	await sessionStore.connection.sendMessage(sid, message).match(
		() => {},
		(error) => {
			throw error;
		}
	);
}

async function handleFixCiCheck(check: PrChecksItem): Promise<void> {
	if (!sessionId) return;
	const label = check.workflowName ? `${check.workflowName} › ${check.name}` : check.name;
	const urlLine = check.detailsUrl ? `\n${check.detailsUrl}` : "";
	const message = `Fix the failing CI check: "${label}"${urlLine}`;
	await sessionStore.connection.sendMessage(sessionId, message).match(
		() => {},
		(error) => {
			throw error;
		}
	);
}
</script>

<AgentPanelShell
	widthStyle={widthStyle}
	centerColumnStyle={agentContentColumnStyle}
	{sessionId}
	{panelId}
	{isFullscreen}
	isDraggingEdge={panelState.isDraggingEdge}
	ondragstart={panelState.handleDragStart.bind(panelState)}
	onclick={handlePanelClick}
	onkeydown={handlePanelKeyDown}
>
	{#snippet header()}
		{@const _headerSnippetMark = recordPanelOpenPerformanceMark(panelId, "agent-panel:header-snippet")}
		{#if renderDeferredOpenChrome}
			<AgentPanelHeader
				{pendingProjectSelection}
				{isConnecting}
				isRetryingConnection={connection.isRetrying}
				{sessionId}
				sessionTitle={sessionController.sessionTitle}
				sessionAgentId={sessionController.sessionAgentId}
				currentAgentId={effectivePanelAgentId}
				{availableAgents}
				{agentIconSrc}
				{agentName}
				{isFullscreen}
				isStreaming={sessionController.sessionIsStreaming}
				{hideProjectBadge}
				{sequenceId}
				sessionStatus={sessionController.panelSessionStatus}
				projectPath={sessionController.sessionProjectPath}
				projectName={displayProjectName}
				{projectColor}
				{projectIconSrc}
				linkedPr={sessionController.sessionMetadata?.linkedPr ?? null}
				prLinkMode={sessionController.sessionMetadata?.prLinkMode ?? "automatic"}
				onClose={onClose}
				{onToggleFullscreen}
				onRetryConnection={handleRetryConnection}
				onScrollToTop={scrollToTop}
				firstMessageAttachments={sessionController.firstMessageAttachments}
				onCopyContent={handleCopyContent}
				onOpenInFinder={handleOpenInFinder}
				onCopyStreamingLogPath={handleCopyStreamingLogPath}
				onExportRawStreaming={handleExportRawStreaming}
				{displayTitle}
				{entriesCount}
				insertions={sessionDiffStats.insertions}
				deletions={sessionDiffStats.deletions}
				createdAt={sessionCreatedAt}
				updatedAt={sessionUpdatedAt}
				onOpenRawFile={sessionId && sessionController.sessionProjectPath ? handleOpenRawFile : undefined}
				onOpenInAcepe={sessionId && sessionController.sessionProjectPath ? handleOpenInAcepe : undefined}
				onExportMarkdown={sessionId ? handleExportMarkdown : undefined}
				onExportJson={sessionId ? handleExportJson : undefined}
				{onAgentChange}
				browserActive={showBrowserSidebar}
				browserTitle="Toggle browser"
				browserAriaLabel="Toggle browser"
				onToggleBrowser={
					panelId
						? () => {
								panelStore.toggleBrowserSidebar(panelId);
							}
						: undefined
				}
				terminalActive={isTerminalDrawerOpen}
				terminalDisabled={effectivePathForGit === null}
				terminalTitle={
					effectivePathForGit !== null ? "Toggle terminal" : "No project selected"
				}
				terminalAriaLabel="Toggle terminal"
				onToggleTerminal={
					panelId && effectivePathForGit
						? () => {
								panelStore.toggleEmbeddedTerminalDrawer(panelId, effectivePathForGit);
							}
						: undefined
				}
					activeWorktreePath={footerWorktreeStatus ? effectiveActiveWorktreePath : null}
					activeWorktreeLabel={footerWorktreeStatus?.primaryLabel ?? null}
					onOpenWorktree={footerWorktreeStatus ? handleOpenWorktree : undefined}
				/>
		{:else}
			<div
				class="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3"
				data-testid="agent-panel-header-deferred-placeholder"
				aria-hidden="true"
			>
				<div class="h-4 w-40 rounded bg-muted/25"></div>
				<div class="ml-auto h-6 w-24 rounded bg-muted/15"></div>
			</div>
		{/if}
		{/snippet}

	{#snippet leadingPane()}
		{#if panelId && hasAttachedFilePane}
			<AgentAttachedFilePane
				ownerPanelId={panelId}
				projects={allProjects}
				columnWidth={ATTACHED_COLUMN_WIDTH}
				isFullscreenEmbedded={isFullscreen}
			/>
		{/if}
	{/snippet}

	{#snippet topBar()}
		<div>
			{#if hasPlan && planState.plan && panelId && !showPlanSidebar}
				<SharedPlanHeader
					title={planState.plan.title}
					isExpanded={showPlanSidebar}
					expandLabel={"Open"}
					collapseLabel={"Close"}
					onToggleSidebar={() => panelStore.setPlanSidebarExpanded(panelId, !showPlanSidebar)}
				/>
			{/if}

			{#if planState.plan}
				<PlanDialog
					plan={planState.plan}
					open={panelState.showPlanDialog}
					onOpenChange={(open) => (panelState.showPlanDialog = open)}
					projectPath={sessionController.sessionProjectPath ?? undefined}
				/>
			{/if}
		</div>
	{/snippet}

	{#snippet body()}
		{@const _contentSnippetMark = recordPanelOpenPerformanceMark(panelId, "agent-panel:content-snippet")}
		<div class="flex h-full min-h-0 flex-col">
			{#if checkpointTimeline.isOpen && sessionController.sessionProjectPath && sessionId}
				<CheckpointTimeline
					{sessionId}
					projectPath={sessionController.sessionProjectPath}
					checkpoints={checkpointTimeline.checkpoints}
					isLoading={checkpointTimeline.isLoading}
					onClose={() => checkpointTimeline.close()}
					onRevertComplete={handleCheckpointRevertComplete}
				/>
			{:else}
				<div class="flex-1 min-h-0 mb-2">
					<AgentPanelContent
						bind:this={contentRef}
						bind:scrollContainer
						bind:scrollViewport={contentScrollViewport}
						bind:isAtBottom={contentScrollReveal.isAtBottom}
						bind:isAtTop={contentScrollReveal.isAtTop}
						bind:hasUnreadBelow={contentScrollReveal.hasUnreadBelow}
						bind:isStreaming={contentScrollReveal.isStreaming}
						panelId={sessionController.effectivePanelId}
						{viewState}
						{sessionId}
						sceneEntries={tokenRevealSceneEntries}
						optimisticUserEntry={sessionController.optimisticUserEntryForViewport}
						{pendingUserRevealRequestKey}
						showLocalPlanningIndicator={sessionController.showPlanningIndicator}
						sessionProjectPath={effectiveProjectPath ?? sessionController.sessionProjectPath}
						{allProjects}
						onProjectSelected={handleProjectSelected}
						onRetryConnection={handleRetryConnection}
						onCancelConnection={handleCancelConnection}
						agentIconSrc={agentIconSrc ?? undefined}
						{showWorkingSpark}
						{planningPlaceholderPresentation}
						{isFullscreen}
						{availableAgents}
						{effectiveTheme}
						{modifiedFilesState}
						onQuestionSelect={handleQuestionSelect}
						onPlanBuild={handlePlanBuild}
						onPlanCancel={handlePlanCancel}
						onPlanViewFull={handlePlanViewFull}
						onToolFileSelect={handleToolFileSelect}
						onUserFileSelect={handleUserFileSelect}
						onReview={handleReviewAction}
						{isPlanActionAvailable}
					/>
				</div>
			{/if}
		</div>
	{/snippet}

	{#snippet preComposer()}
		{@const _preComposerSnippetMark = recordPanelOpenPerformanceMark(panelId, "agent-panel:pre-composer-snippet")}
		{#if viewState.kind === "conversation"}
			<SharedAgentPanelTranscriptScrollControls
				showScrollToTop={!contentScrollReveal.isAtTop}
				showScrollToBottom={!contentScrollReveal.isAtBottom}
				hasUnreadBelow={contentScrollReveal.hasUnreadBelow}
				onScrollToTop={scrollToTop}
				onScrollToBottom={scrollToBottom}
				centered={centeredFullscreenContent}
				widthClass="max-w-3xl"
			/>
			{/if}
			{#if hasPreComposerStackContent}
				<AgentPanelPreComposerStack
					showConversationChrome={viewState.kind === "conversation" ||
						viewState.kind === "ready" ||
						viewState.kind === "error"}
					{worktreeDeleted}
					{centeredFullscreenContent}
					{showInlineErrorCard}
					errorInfo={sessionController.errorInfo}
					inlineErrorReferenceId={sessionController.inlineErrorReferenceId}
					inlineErrorReferenceSearchable={sessionController.inlineErrorReferenceSearchable}
					onRetryConnection={handleRetryConnection}
					isRetryingConnection={connection.isRetrying}
					onUnarchiveSession={handleUnarchiveSession}
					{isUnarchivingSession}
					onDismissError={handleDismissError}
					onCopyInlineErrorReference={handleCopyInlineErrorReference}
					inlineErrorIssueDraft={inlineErrorIssueDraft}
					onIssueFromInlineError={handleIssueFromInlineError}
					{preSessionWorktreeFailure}
					worktreeToggleProjectPath={worktreeToggleProjectPath}
					onPreSessionWorktreeDismiss={handlePreSessionWorktreeDismiss}
					onPreSessionWorktreeYes={handlePreSessionWorktreeYes}
					onPreSessionWorktreeNo={handlePreSessionWorktreeNo}
					onRetryWorktree={handleRetryWorktree}
					worktreePending={worktreePending}
					worktreeSetupState={worktreeSetup.state}
					{agentInstallState}
					{sessionId}
					effectiveProjectPath={effectiveProjectPath ?? null}
					sessionProjectPath={sessionController.sessionProjectPath ?? null}
					{effectivePathForGit}
					{createdPr}
					createPrRunning={prCard.createRunning}
					prCardRenderKey={prCard.renderKey}
					prDetails={prCard.details}
					prFetchError={prCard.fetchError}
					linkedPr={sessionController.sessionMetadata?.linkedPr ?? null}
					streamingShipData={prCard.streamingShipData}
					onFixCiCheck={(check) => void handleFixCiCheck(check)}
					{showTodoHeader}
					{todoState}
					queueStripMessages={queueStripDisplayMessages}
					{queueIsPaused}
					onQueueCancel={handleQueueStripCancel}
					onQueueRemoveAttachment={handleQueueStripRemoveAttachment}
					onQueueClear={handleQueueStripClear}
					onQueueResume={queueIsPaused && sessionId ? () => messageQueueStore.resume(sessionId) : undefined}
					onQueueSendNow={handleQueueStripSendNow}
					signInRequirement={sessionController.signInRequirement}
					{isSigningIn}
					{signInError}
					onSignIn={handleSignIn}
					onCancelSignIn={handleCancelSignIn}
					onDismissSignIn={handleDismissSignIn}
				/>
			{/if}
		{/snippet}

	{#snippet composer()}
		{@const _composerSnippetMark = recordPanelOpenPerformanceMark(panelId, "agent-panel:composer-snippet")}
		<div>
			{#if viewState.kind === "conversation" || viewState.kind === "ready" || viewState.kind === "error"}
				<SharedAgentPanelComposerFrame
					centered={centeredFullscreenContent}
					widthClass="max-w-3xl"
				>
					{#if renderComposerInput}
						{#key inputRenderKey}
							{#snippet newThreadProjectControl()}
								<ProjectSelector
									selectedProject={preSessionSelectedProject}
									recentProjects={allProjects}
									onProjectChange={handleComposerProjectSelected}
									showLabel
								/>
							{/snippet}
							{#snippet newThreadAgentControl()}
								<AgentSelector
									{availableAgents}
									currentAgentId={effectivePanelAgentId}
									{onAgentChange}
									showLabel
								/>
							{/snippet}
								{#snippet newThreadBranchControl()}
									{#if worktreeToggleProjectPath}
									<BranchPicker
										projectPath={worktreeToggleProjectPath}
										currentBranch={preSessionCurrentBranch}
										diffStats={preSessionDiffStats}
										isGitRepo={preSessionIsGitRepo}
										variant="setupBarChip"
										onBranchSelected={(branch) => {
											preSessionCurrentBranch = branch;
											if (worktreeToggleProjectPath) {
												refreshPreSessionBranchMetadata(worktreeToggleProjectPath, {
													loadDetails: true,
												});
											}
										}}
										onInitGitRepo={() => {
											if (!worktreeToggleProjectPath) {
												return;
											}
											void tauriClient.git.init(worktreeToggleProjectPath).match(
												() => {
													refreshPreSessionBranchMetadata(worktreeToggleProjectPath, {
														loadDetails: true,
													});
												},
												(error) => {
													const message =
														error.cause?.message ?? error.message ?? "Failed to initialize git";
													toast.error(message);
												}
											);
										}}
									/>
									{/if}
								{/snippet}
							{#if true}
								{@const _agentInputBeforeMark = recordPanelOpenPerformanceMark(panelId, "agent-panel:agent-input-before")}
							{/if}
							<AgentInput
							bind:this={agentInputRef}
							sessionId={sessionId ?? undefined}
							sessionIsConnected={sessionController.sessionIsConnected}
							sessionIsStreaming={sessionController.sessionIsStreaming}
							sessionCanSubmit={sessionController.sessionCanSubmit}
							sessionShowStop={sessionController.sessionShowStop}
							disableSend={sessionController.disableSendForFailedFirstSend || isSigningIn}
							{panelId}
							voiceSessionId={panelId}
							projectPath={worktreeToggleProjectPath ?? undefined}
							projectName={effectiveProjectName ?? undefined}
							worktreePath={effectiveActiveWorktreePath ?? undefined}
							{worktreePending}
							preparedWorktreeLaunch={panelPreparedWorktreeLaunch}
							onWorktreeCreating={() => {
								worktreeController.clearPreSessionWorktreeFailure();
								worktreeSetup.startCreation({
									projectPath:
										worktreeToggleProjectPath || sessionController.sessionProjectPath || project?.path || "",
								});
							}}
							onWorktreeCreated={(path) => handleWorktreeCreated(path)}
							onPreparedWorktreeLaunch={handlePreparedWorktreeLaunch}
							onPreparedWorktreeLaunchCleared={() => {
								if (panelId) {
									panelStore.clearPreparedWorktreeLaunch(panelId);
								}
							}}
							onWorktreeCreateFailed={handlePreSessionWorktreeFailure}
							{selectedAgentId}
							{availableAgents}
							{onAgentChange}
							newThreadContext={
								showNewThreadSetupContext
									? {
										project: newThreadProjectControl,
										agent: newThreadAgentControl,
										branch: newThreadBranchControl,
										showWorktree: showPreSessionWorktreeCard && worktreeToggleProjectPath !== null,
										worktreeOn: worktreePending,
										worktreeDisabled: false,
										onWorktreeToggle: (on) => {
											if (on) {
												handlePreSessionWorktreeYes();
											} else {
												handlePreSessionWorktreeNo();
											}
										},
										worktreeDefaultOn: worktreeDefaultStore.globalDefault,
										onWorktreeDefaultToggle: (on) => {
											void worktreeDefaultStore.set(on);
										},
									}
									: null
							}
							pendingProjectSelection={pendingProjectSelection && !isWaitingForSession}
							{deferInitialComposerMountWork}
							onSessionCreated={handleSessionCreated}
							onWillSend={prepareForNextUserReveal}
							onToolbarWidthChange={(w) => {
								layoutController.setToolbarMinWidth(w);
							}}
							showCheckpointInAttachMenu={Boolean(
								sessionController.sessionProjectPath &&
									checkpointTimeline.checkpoints.length > 0
							)}
						>
							{#snippet checkpointButton()}
								{#if sessionController.sessionProjectPath && checkpointTimeline.checkpoints.length > 0}
									<Button
										variant="ghost"
										size="icon"
										data-header-control
										active={checkpointTimeline.isOpen}
										title="View checkpoints"
										aria-label="View checkpoints"
										onclick={() => checkpointTimeline.toggle()}
									>
										{#snippet children()}
											<RoundedIcon name="clock" />
										{/snippet}
									</Button>
								{/if}
								{/snippet}
							</AgentInput>
							{#if true}
								{@const _agentInputAfterMark = recordPanelOpenPerformanceMark(panelId, "agent-panel:agent-input-after")}
							{/if}
						{/key}
					{:else}
						<div
							class="shrink-0 border-t border-border/50 p-3"
							data-testid="agent-input-deferred-placeholder"
							aria-hidden="true"
						>
							<div class="min-h-[71px] rounded-xl bg-input/30 shadow-sm"></div>
						</div>
					{/if}
				</SharedAgentPanelComposerFrame>
			{/if}
		</div>
	{/snippet}

	{#snippet bottomDrawer()}
		<div>
			{#if
				(viewState.kind === "conversation" || viewState.kind === "ready" || viewState.kind === "error") &&
				isTerminalDrawerOpen &&
				panelId &&
				effectivePathForGit
			}
				<AgentPanelTerminalDrawer
					{panelId}
					effectiveCwd={effectivePathForGit}
					embeddedTerminals={panelStore.embeddedTerminals}
					onClose={() => panelStore.setEmbeddedTerminalDrawerOpen(panelId, false)}
				/>
			{/if}
		</div>
	{/snippet}

	{#snippet trailingPane()}
		{#if panelId}
			<AgentPanelTrailingPaneLayout
				showPlan={Boolean(hasPlan && planState.plan && showPlanSidebar)}
				showBrowser={Boolean(showBrowserSidebar)}
			>
				{#snippet plan()}
					<PlanSidebar
						plan={planState.plan!}
						projectPath={sessionController.sessionProjectPath ?? undefined}
						columnWidth={PLAN_SIDEBAR_COLUMN_WIDTH}
						onOpenFullscreen={() => panelState.openPlanDialog()}
						onClose={() => panelStore.setPlanSidebarExpanded(panelId, false)}
					/>
				{/snippet}
				{#snippet browser()}
					<div
						class="flex flex-col h-full border-l border-border/50 shrink-0"
						style="min-width: {BROWSER_SIDEBAR_COLUMN_WIDTH}px; width: {BROWSER_SIDEBAR_COLUMN_WIDTH}px; max-width: {BROWSER_SIDEBAR_COLUMN_WIDTH}px;"
					>
						<BrowserPanelComponent
							panelId="embedded-browser-{panelId}"
							url={browserSidebarUrl ?? DEFAULT_BROWSER_HOME_URL}
							title="Browser"
							width={BROWSER_SIDEBAR_COLUMN_WIDTH}
							isFillContainer={true}
							onClose={() => panelStore.setBrowserSidebarExpanded(panelId, false)}
							onResize={() => {}}
						/>
					</div>
				{/snippet}
			</AgentPanelTrailingPaneLayout>
		{/if}
	{/snippet}

	{#snippet resizeEdge()}
		{#if !isFullscreen}
			<AgentPanelResizeEdge
				isDragging={panelState.isDraggingEdge}
				onPointerDown={(e) => panelState.handlePointerDownEdge(e, panelId, width)}
				onPointerMove={(e) => panelState.handlePointerMoveEdge(e, panelId)}
				onPointerUp={() => panelState.handlePointerUpEdge(panelId, onResizePanel)}
			/>
		{/if}
	{/snippet}
</AgentPanelShell>

{#if reviewDialog.isOpen}
	<DialogFrame
		open={reviewDialog.isOpen}
		title="Review changes"
		closeLabel="Close review"
		contentOverflow="hidden"
		contentClass="!bg-background !rounded-lg"
		onOpenChange={(open) => reviewDialog.setOpen(open)}
	>
		{#snippet topLeft()}
			{#if !createdPr}
				<Button
					variant="secondary"
					size="xs"
					class="shrink-0"
					disabled={prCard.createRunning || !effectivePathForGit}
					onclick={() => void handleCreatePr()}
				>
					<RoundedIcon name="pull-request" class="size-[11px] shrink-0" />
					{prCard.createLabel ?? "Open PR"}
					<DiffPill
						insertions={reviewDialog.diffStats.insertions}
						deletions={reviewDialog.diffStats.deletions}
						variant="plain"
					/>
				</Button>
			{:else}
				<Button variant="secondary" size="xs" class="shrink-0" disabled>
					<RoundedIcon name="pull-request" class="size-[11px] shrink-0 text-success" />
					#{createdPr}
					<DiffPill
						insertions={reviewDialog.diffStats.insertions}
						deletions={reviewDialog.diffStats.deletions}
						variant="plain"
					/>
				</Button>
			{/if}
		{/snippet}

		{#snippet topRight()}
			{@const controls = reviewDialog.controls}
			{@const diffOptions = reviewDialog.diffOptions}
			<div
				class="flex max-w-[min(520px,calc(100vw-12rem))] flex-wrap items-center justify-end gap-1.5"
				data-testid="review-dialog-header-actions"
			>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="secondary"
								size="xs"
								class="shrink-0"
								aria-label="Diff settings"
								title="Diff settings"
								data-testid="review-dialog-diff-settings-trigger"
							>
								<RoundedIcon name="settings" class="size-[13px] shrink-0" />
								Diff
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						align="end"
						sideOffset={6}
						class="w-64"
						data-testid="review-dialog-diff-settings-menu"
					>
						<DropdownMenu.Group>
							<DropdownMenu.GroupHeading>Layout</DropdownMenu.GroupHeading>
							<DropdownMenu.RadioGroup
								value={reviewDialog.diffStyle}
								onValueChange={handleReviewDiffStyleChange}
							>
								<DropdownMenu.RadioItem
									value="unified"
									onSelect={keepReviewDiffSettingsMenuOpen}
									data-testid="review-dialog-diff-style-unified"
								>
									<RoundedIcon name="git-diff-unified" class="size-3" />
									Unified
								</DropdownMenu.RadioItem>
								<DropdownMenu.RadioItem
									value="split"
									onSelect={keepReviewDiffSettingsMenuOpen}
									data-testid="review-dialog-diff-style-split"
								>
									<RoundedIcon name="git-diff" class="size-3" />
									Split
								</DropdownMenu.RadioItem>
							</DropdownMenu.RadioGroup>
						</DropdownMenu.Group>

						<DropdownMenu.Separator />

						<DropdownMenu.Group>
							<DropdownMenu.GroupHeading>Indicators</DropdownMenu.GroupHeading>
							<DropdownMenu.RadioGroup
								value={diffOptions.indicatorStyle}
								onValueChange={handleReviewDiffIndicatorStyleChange}
							>
								<DropdownMenu.RadioItem
									value="bars"
									onSelect={keepReviewDiffSettingsMenuOpen}
									data-testid="review-dialog-diff-indicators-bars"
								>
									<RoundedIcon name="diff-bars" class="size-3" />
									Bars
								</DropdownMenu.RadioItem>
								<DropdownMenu.RadioItem
									value="classic"
									onSelect={keepReviewDiffSettingsMenuOpen}
									data-testid="review-dialog-diff-indicators-classic"
								>
									<RoundedIcon name="diff-classic" class="size-3" />
									Classic
								</DropdownMenu.RadioItem>
								<DropdownMenu.RadioItem
									value="none"
									onSelect={keepReviewDiffSettingsMenuOpen}
									data-testid="review-dialog-diff-indicators-none"
								>
									<RoundedIcon name="minus" class="size-3" />
									None
								</DropdownMenu.RadioItem>
							</DropdownMenu.RadioGroup>
						</DropdownMenu.Group>

						<DropdownMenu.Separator />

						<DropdownMenu.Group>
							<DropdownMenu.GroupHeading>Inline Changes</DropdownMenu.GroupHeading>
							<DropdownMenu.RadioGroup
								value={diffOptions.lineChangeStyle}
								onValueChange={handleReviewDiffLineChangeStyleChange}
							>
								<DropdownMenu.RadioItem
									value="none"
									onSelect={keepReviewDiffSettingsMenuOpen}
									data-testid="review-dialog-line-change-none"
								>
									<RoundedIcon name="minus" class="size-3" />
									None
								</DropdownMenu.RadioItem>
								<DropdownMenu.RadioItem
									value="word"
									onSelect={keepReviewDiffSettingsMenuOpen}
									data-testid="review-dialog-line-change-word"
								>
									<RoundedIcon name="format" class="size-3" />
									Word
								</DropdownMenu.RadioItem>
								<DropdownMenu.RadioItem
									value="character"
									onSelect={keepReviewDiffSettingsMenuOpen}
									data-testid="review-dialog-line-change-character"
								>
									<RoundedIcon name="code" class="size-3" />
									Character
								</DropdownMenu.RadioItem>
							</DropdownMenu.RadioGroup>
						</DropdownMenu.Group>

						<DropdownMenu.Separator />

						<DropdownMenu.Group>
							<DropdownMenu.GroupHeading>Display</DropdownMenu.GroupHeading>
							<DropdownMenu.CheckboxItem
								checked={diffOptions.showBackgrounds}
								onCheckedChange={(checked) =>
									reviewDialog.setDiffShowBackgrounds(checked === true)}
								onSelect={keepReviewDiffSettingsMenuOpen}
								data-testid="review-dialog-toggle-backgrounds"
							>
								<RoundedIcon name="diff-backgrounds" class="size-3" />
								Backgrounds
							</DropdownMenu.CheckboxItem>
							<DropdownMenu.CheckboxItem
								checked={diffOptions.wrapLines}
								onCheckedChange={(checked) => reviewDialog.setDiffWrapLines(checked === true)}
								onSelect={keepReviewDiffSettingsMenuOpen}
								data-testid="review-dialog-toggle-wrapping"
							>
								<RoundedIcon name="diff-wrapping" class="size-3" />
								Wrapping
							</DropdownMenu.CheckboxItem>
							<DropdownMenu.CheckboxItem
								checked={diffOptions.showLineNumbers}
								onCheckedChange={(checked) =>
									reviewDialog.setDiffShowLineNumbers(checked === true)}
								onSelect={keepReviewDiffSettingsMenuOpen}
								data-testid="review-dialog-toggle-line-numbers"
							>
								<RoundedIcon name="diff-line-numbers" class="size-3" />
								Line Numbers
							</DropdownMenu.CheckboxItem>
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				{#if controls && controls.fileTotal > 1}
					<ButtonGroup.Root class="shrink-0" aria-label="File navigation">
						<Button
							variant="secondary"
							size="xs"
							disabled={!controls.hasPrevFile}
							onclick={controls.onPrevFile}
							aria-label="Previous file"
							title="Previous file"
						>
							<RoundedIcon name="chevron-left" class="size-3" />
						</Button>
						<Button
							variant="secondary"
							size="xs"
							class="tabular-nums pointer-events-none"
							disabled
							aria-label="File {controls.fileCurrent} of {controls.fileTotal}"
						>
							{controls.fileCurrent}/{controls.fileTotal}
						</Button>
						<Button
							variant="secondary"
							size="xs"
							disabled={!controls.hasNextFile}
							onclick={controls.onNextFile}
							aria-label="Next file"
							title="Next file"
						>
							<RoundedIcon name="chevron-right" class="size-3" />
						</Button>
					</ButtonGroup.Root>
				{/if}

				{#if controls}
					<Button
						variant="secondary"
						size="xs"
						class="shrink-0"
						onclick={controls.onToggleReviewed}
						title={controls.isReviewed ? "Mark file as not reviewed" : "Mark file reviewed"}
					>
						{#if controls.isReviewed}
							<RoundedIcon name="check-circle" class="shrink-0 text-success" style="width: 11px; height: 11px;" />
							Reviewed
						{:else}
							<span class="block size-[11px] shrink-0 rounded-full border border-current opacity-50"></span>
							Mark reviewed
						{/if}
					</Button>
					<Button
						variant="secondary"
						size="xs"
						class="shrink-0"
						onclick={() => {
							reviewRevertConfirmFileName =
								reviewDialog.filesState?.files[reviewDialog.clampedFileIndex]?.fileName ?? "this file";
						}}
						title="Revert file"
					>
						<RoundedIcon name="undo" class="shrink-0" style="width: 11px; height: 11px; color: {Colors.red};" />
						Revert
					</Button>
				{/if}
			</div>
		{/snippet}

		{#if reviewDialog.filesState}
			<AgentPanelReviewWorkspace
				{sessionId}
				reviewFilesState={reviewDialog.filesState}
				selectedFileIndex={reviewDialog.clampedFileIndex}
				projectPath={effectiveProjectPath ?? sessionController.sessionProjectPath}
				isActive={reviewDialog.isOpen}
				showHeader={false}
				showCloseButton={false}
				compact={true}
				flat={true}
				diffDensity="default"
				diffStyle={reviewDialog.diffStyle}
				diffOptions={reviewDialog.diffOptions}
				hideBottomWidget={true}
				onControlsChange={(controls) => reviewDialog.setControls(controls)}
				onClose={() => reviewDialog.setOpen(false)}
				onFileIndexChange={(index) => reviewDialog.setFileIndex(index)}
			/>
		{/if}
	</DialogFrame>
{/if}

{#if reviewRevertConfirmFileName !== null}
	<AlertDialog.Root
		open={true}
		onOpenChange={(open) => {
			if (!open) {
				reviewRevertConfirmFileName = null;
			}
		}}
	>
		<AlertDialog.Portal>
			<AlertDialog.Overlay
				class="fixed inset-0 z-[calc(var(--overlay-z,50)+20)] bg-black/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
			/>
			<AlertDialog.Content
				class="fixed left-1/2 top-1/2 z-[calc(var(--overlay-z,50)+21)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
			>
				<AlertDialog.Title class="text-sm font-medium text-foreground">
					Revert file?
				</AlertDialog.Title>
				<AlertDialog.Description class="mt-1.5 text-sm leading-snug text-muted-foreground">
					This discards the agent's changes to {reviewRevertConfirmFileName} in your working tree.
					This cannot be undone.
				</AlertDialog.Description>
				<div class="mt-4 flex items-center justify-end gap-2">
					<AlertDialog.Cancel
						class="inline-flex h-8 items-center justify-center rounded-md border border-border bg-transparent px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						Cancel
					</AlertDialog.Cancel>
					<AlertDialog.Action
						class="inline-flex h-8 items-center justify-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
						onclick={() => {
							reviewDialog.controls?.onRevertFile();
							reviewRevertConfirmFileName = null;
						}}
					>
						Revert
					</AlertDialog.Action>
				</div>
			</AlertDialog.Content>
		</AlertDialog.Portal>
	</AlertDialog.Root>
{/if}

{#if inlinePlanDialogPlan}
	<PlanDialog
		plan={inlinePlanDialogPlan}
		open={inlinePlanDialogPlan !== null}
		onOpenChange={handleInlinePlanDialogOpenChange}
		projectPath={sessionController.sessionProjectPath ?? undefined}
	/>
{/if}
