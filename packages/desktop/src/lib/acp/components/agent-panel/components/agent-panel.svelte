<script lang="ts">
import {
	AgentPanelShell,
	type AgentPanelPlanActionEvent,
	type AgentPanelPlanViewEvent,
	type AgentPanelQuestionSelectEvent,
	type AgentPanelSceneEntryModel,
	type AgentToolFileSelectEvent,
} from "@acepe/ui/agent-panel";
import { DiffPill, setThinkingPreferences } from "@acepe/ui";
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import { CaretLeft, CaretRight, CheckCircle, Clock, GitPullRequest, XCircle } from "phosphor-svelte";
import { onDestroy, onMount, tick } from "svelte";
import { toast } from "svelte-sonner";
import { deriveLocalReferenceId } from "$lib/errors/error-reference.js";
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
import { api } from "../../../store/api.js";
import { getChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import { mergeStrategyStore } from "../../../store/merge-strategy-store.svelte.js";
import { sessionReviewStateStore } from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { PanelConnectionEvent } from "../../../types/panel-connection-state.js";
import { PanelConnectionState } from "../../../types/panel-connection-state.js";
import type { WorktreeInfo } from "../../../types/worktree-info.js";
import { computeStatsFromCheckpoints } from "../../../utils/checkpoint-diff-utils.js";
import { Colors, getProjectColor, TAG_COLORS } from "@acepe/ui/colors";
import { extractAttachmentsFromChunks } from "../../../utils/extract-content-attachments.js";
import { createLogger } from "../../../utils/logger.js";
import AgentInput from "../../agent-input/agent-input-ui.svelte";
import AgentSelector from "../../agent-selector.svelte";
import ProjectSelector from "../../project-selector.svelte";
import { shouldDisableSendForFailedFirstSend } from "../../agent-input/logic/first-send-recovery.js";
import type { Attachment } from "../../agent-input/types/attachment.js";
import { CheckpointTimeline } from "../../checkpoint/index.js";
import type { PrGenerationConfig } from "../../modified-files/types/pr-generation-config.js";
import * as agentModelPrefs from "../../../store/agent-model-preferences-store.svelte.js";
import {
	AgentPanelComposerFrame as SharedAgentPanelComposerFrame,
	AgentPanelPlanHeader as SharedPlanHeader,
} from "@acepe/ui/agent-panel";
import PlanDialog from "../../plan-dialog.svelte";
import { getMessageQueueStore } from "../../../store/message-queue/message-queue-store.svelte.js";
import { getTodoStateManager } from "../../../logic/todo-state-manager.svelte.js";
import { usePlanLoader } from "../hooks";
import {
	createWorktreeSetupMatchContext,
	createPendingWorktreeCloseConfirmationState,
	createResolvedWorktreeCloseConfirmationState,
	createWorktreeCreationState,
	copyTextToClipboard,
	applyAgentPanelDisplayMemory,
	buildAgentPanelBaseModel,
	createAgentPanelDisplayMemory,
	createAgentPanelDisplaySceneEntriesReadModel,
	createAgentPanelDisplayRowsReadModel,
	deriveCanonicalUserEntryPresence,
	deriveCanonicalAgentPanelSessionState,
	derivePanelErrorInfo,
	matchesWorktreeSetupContext,
	resolveOptimisticUserEntryForGraph,
	resolveCanonicalAgentPanelTurnState,
	resolveVisibleEntryCount,
	removeWorktreeAndMarkSessionWorktreeDeleted,
	reduceWorktreeSetupEvent,
	resolveEffectiveProjectPath,
	shouldConfirmWorktreeClose,
} from "../logic";
import { createAgentPanelGraphMaterializerReadModel } from "../../../session-state/agent-panel-graph-materializer.js";
import { resolveAgentPanelWorktreePending } from "../logic/worktree-pending.js";
import { getWorktreeDefaultStore } from "../../worktree/worktree-default-store.svelte.js";
import { DEFAULT_BROWSER_HOME_URL } from "../../../constants/browser-defaults.js";
import { getProviderBrandIcon } from "../../../constants/thread-list-constants.js";
import { derivePanelViewState } from "../../../logic/panel-visibility.js";
import { createPanelBranchLookupController } from "../logic/panel-branch-lookup.js";
import type { WorktreeSetupState } from "../logic/worktree-setup-events.js";
import { shouldAutoScrollOnPanelActivation } from "../logic/should-auto-scroll-on-panel-activation.js";
import { deriveAgentPanelHeaderDisplayTitle } from "../logic/agent-panel-header-title.js";
import { resolveAgentPanelProviderBrand } from "../logic/agent-panel-provider-brand.js";
import { shouldShowPreSessionWorktreeCard } from "../logic/pre-session-worktree-card-visibility.js";
import { resolveWorktreeToggleProjectPath } from "../logic/worktree-toggle-project-path.js";
import { createGraphSceneEntryIndexReadModel } from "../logic/graph-scene-entry-match.js";
import { createTokenRevealSceneReadModel } from "../logic/token-reveal-scene-read-model.js";
import {
	buildTokenRevealCss,
	hasStreamingPreviewContent,
} from "./agent-panel-pure-helpers.js";
import { AgentPanelState } from "../state/agent-panel-state.svelte";
import type { AgentPanelProps } from "../types";
import {
	createLegacyInteractionReplyHandler,
	normalizeInteractionReplyHandler,
} from "../../../types/reply-handler.js";
import { AgentPanelFooter as SharedFooter } from "@acepe/ui/agent-panel";
import WorktreeFooterButton from "../../shared/worktree-footer-button.svelte";
import AgentPanelContent from "./agent-panel-content.svelte";
import AgentPanelHeader from "./agent-panel-header.svelte";
import AgentPanelResizeEdge from "./agent-panel-resize-edge.svelte";
import AgentPanelReviewWorkspace from "./agent-panel-review-workspace.svelte";
import type { ReviewControlsSnapshot } from "./agent-panel-review-content.svelte";
import WorkspaceDialogFrame from "$lib/components/ui/workspace-dialog-frame.svelte";
import AgentPanelTerminalDrawer from "./agent-panel-terminal-drawer.svelte";
import AgentPanelPreComposerStack from "./agent-panel-pre-composer-stack.svelte";
import { PlanSidebar } from "../../plan-sidebar/index.js";
import { BrowserPanel as BrowserPanelComponent } from "../../browser-panel/index.js";
import {
	AgentPanelTrailingPaneLayout,
	AgentPanelWorktreeCloseConfirmPopover,
} from "@acepe/ui/agent-panel";
import ScrollToBottomButton from "./scroll-to-bottom-button.svelte";
import {
	resolveAgentContentColumnStyle,
	resolveAgentPanelEffectiveWidth,
	resolveAgentPanelWidthStyle,
	shouldUseCenteredFullscreenContent,
} from "./agent-panel-layout.js";
import { buildAgentErrorIssueDraft } from "../logic/issue-report-draft.js";
import type { PanelConnectionErrorDetails } from "../../../types/panel-connection-state.js";
import { resolveInitialReviewWorkspaceIndex } from "./review-workspace-model.js";
import {
	cancelQueuedMessageAndRestoreInput,
	clearMessageQueue,
	removeAttachmentFromQueuedMessage,
	sendQueuedMessageNow,
} from "../logic/queue-strip-handlers.js";
import { resolveTokenRevealSettleDelayMs } from "../../messages/token-reveal-motion.js";
import {
	copyStreamingLogPathToClipboard,
	copyThreadContentToClipboard,
	discardPreparedWorktreeSessionLaunch,
	exportSessionJsonToClipboard,
	exportSessionMarkdownToClipboard,
	fetchPanelGitBranch,
	fetchWorktreeHasUncommittedChanges,
	fetchWorktreePathListedForProject,
	loadCheckpointsBeforeTimelineOpen,
	openSessionFileInAcepePanel,
	openSessionInFinder,
	openSessionRawFileInEditor,
	openStreamingLog,
	persistSessionWorktreePathAfterRename,
	removeWorktreeFromDisk,
	runCreatePrWorkflow,
	runMergePrWorkflow,
	runPanelConnectionRetry,
	scheduleCheckpointReloadAfterRevert,
	subscribeGitWorktreeSetupChannel,
} from "../services/index.js";
import { resolveProjectFileReference } from "../../messages/logic/file-chip-diff-enhancer.js";

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
	bypassWorktreeCloseConfirmation = false,
	onCreateSessionForProject,
	onSessionCreated,
	onResizePanel,
	onToggleFullscreen,
	isFullscreen = false,
	isFocused = false,
	hideProjectBadge = false,
	onFocus,
	reviewMode = false,
	reviewFilesState = null,
	reviewFileIndex = 0,
	onEnterReviewMode,
	onExitReviewMode,
	onReviewFileIndexChange,
	hasAttachedFilePane = false,
	onCreateIssueReport,
}: AgentPanelProps = $props();

// ✅ State managers (must be before derived values that use them)
const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const chatPreferencesStore = getChatPreferencesStore();

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
const connectionStore = getConnectionStore();
const interactionStore = getInteractionStore();
const permissionStore = getPermissionStore();
const agentStore = getAgentStore();
const messageQueueStore = getMessageQueueStore();
const logger = createLogger({ id: "agent-panel-render-trace", name: "AgentPanelRenderTrace" });
let lastPanelTraceSignature = $state<string | null>(null);
let agentPanelDisplayMemory = createAgentPanelDisplayMemory();
const agentPanelDisplayRowsReadModel = createAgentPanelDisplayRowsReadModel();
const agentPanelDisplaySceneEntriesReadModel = createAgentPanelDisplaySceneEntriesReadModel();
const tokenRevealSourceIndexReadModel = createGraphSceneEntryIndexReadModel();
const tokenRevealSceneReadModel = createTokenRevealSceneReadModel();
let prefersReducedMotion = $state(false);

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

// Identity: id, projectPath, agentId, worktreePath (immutable - never changes)
const sessionIdentity = $derived(sessionId ? sessionStore.getSessionIdentity(sessionId) : null);

// Metadata: title, createdAt, updatedAt (rarely changes)
const sessionMetadata = $derived(sessionId ? sessionStore.getSessionMetadata(sessionId) : null);
const sessionPendingSendIntent = $derived(
	sessionId ? sessionStore.getSessionPendingSendIntent(sessionId) : null
);

// Entries: conversation content (changes frequently during streaming)
// Merges any optimistic pending entry (shown before session creation) with real entries.
// Fast path: when no pending entry (99% of renders), returns the exact array reference — zero allocation.
// Note: getHotState(panelId) subscribes to ALL hot state changes for this panel (messageDraft,
// reviewMode, etc.), not just pendingUserEntry. This causes extra recomputations during typing,
// but the fast path returns the same array reference so Svelte skips DOM updates. Acceptable trade-off.
const panelHotState = $derived(panelId ? panelStore.getHotState(panelId) : null);
const preSessionPendingUserEntry = $derived(
	sessionId === null || sessionId === undefined ? (panelHotState?.pendingUserEntry ?? null) : null
);
const canonicalTranscriptEntries = $derived(
	sessionId === null || sessionId === undefined
		? null
		: sessionStore.getSessionTranscriptEntries(sessionId)
);
const canonicalUserEntryPresence = $derived.by(() => {
	const pending = sessionPendingSendIntent;
	const transcriptEntries =
		sessionId === null || sessionId === undefined ? [] : canonicalTranscriptEntries;
	return deriveCanonicalUserEntryPresence({
		transcriptEntries,
		pendingAttemptId: pending?.attemptId ?? null,
	});
});
const optimisticUserEntryForGraph = $derived(
	resolveOptimisticUserEntryForGraph({
		panelPendingUserEntry: panelHotState?.pendingUserEntry ?? null,
		sessionPendingOptimisticEntry: sessionPendingSendIntent?.optimisticEntry ?? null,
		hasCanonicalUserEntry: canonicalUserEntryPresence.hasCanonicalUserEntry,
		hasCanonicalMatchingPendingUserEntry:
			canonicalUserEntryPresence.hasCanonicalMatchingPendingUserEntry,
	})
);
const hasImmediatePendingSendIntent = $derived(
	sessionPendingSendIntent !== null || optimisticUserEntryForGraph !== null
);
const panelSnapshot = $derived(panelId ? panelStore.getTopLevelPanel(panelId) : null);
const panelPendingWorktreeEnabled = $derived(
	panelSnapshot?.kind === "agent" ? (panelSnapshot.pendingWorktreeEnabled ?? null) : null
);
const panelPreparedWorktreeLaunch = $derived(
	panelSnapshot?.kind === "agent" ? (panelSnapshot.preparedWorktreeLaunch ?? null) : null
);
const firstMessageAttachments = $derived.by(() => {
	const firstUserEntry =
		preSessionPendingUserEntry ?? sessionPendingSendIntent?.optimisticEntry ?? null;
	if (!firstUserEntry || firstUserEntry.type !== "user") return [];
	return extractAttachmentsFromChunks(firstUserEntry.message.chunks ?? []);
});

const visibleEntryCount = $derived(
	resolveVisibleEntryCount({
		canonicalEntryCount:
			sessionId === null || sessionId === undefined
				? 0
				: (canonicalTranscriptEntries?.length ?? null),
		optimisticUserEntry: optimisticUserEntryForGraph,
	})
);
const knownVisibleEntryCount = $derived(visibleEntryCount ?? 0);
const hasMessages = $derived(visibleEntryCount !== null && visibleEntryCount > 0);
const sessionProjectPath = $derived(sessionIdentity?.projectPath ?? null);
const sessionAgentId = $derived(sessionIdentity?.agentId ?? null);
const sessionWorktreePath = $derived(sessionIdentity?.worktreePath ?? null);
const sessionTitle = $derived(sessionMetadata?.title ?? null);

// Current model from canonical capabilities (for PR popover default)
const sessionCurrentModelId = $derived(
	sessionId ? sessionStore.getSessionCurrentModelId(sessionId) : null
);

// ✅ State manager for local UI state only (drag, dialog)
const panelState = new AgentPanelState();
const panelBranchLookup = createPanelBranchLookupController();
let inlinePlanDialogPlan = $state<{ title: string; content: string; summary: null } | null>(null);

// Plan sidebar state from store (centralized, auto-persisted)
const showPlanSidebar = $derived(panelId ? panelStore.isPlanSidebarExpanded(panelId) : false);

// ✅ Hooks at component level (they need prop reactivity)
// Pass granular identity data instead of full session object
const planState = usePlanLoader(() =>
	sessionId && sessionProjectPath && sessionAgentId
		? { id: sessionId, projectPath: sessionProjectPath, agentId: sessionAgentId }
		: null
);

// Simple scroll container binding (updated via bind:)
let scrollContainer: HTMLDivElement | null = $state(null);

// Reference to content component for scroll control
let contentRef: AgentPanelContent | null = $state(null);
let pendingUserRevealRequestVersion = $state(0);

// Scroll viewport reference for scroll-to-bottom button (bindable from child)
let contentScrollViewport: HTMLElement | null = $state(null);
let contentIsAtBottom = $state(true);
let contentIsAtTop = $state(true);
let contentIsStreaming = $state(false);
let tokenRevealSettleRevision = $state(0);
let panelConnectionState = $state<PanelConnectionState | null>(null);
let panelConnectionError = $state<PanelConnectionErrorDetails | null>(null);
// Dismiss tracking: store the error fingerprint that the user dismissed.
// `errorDismissed` is a $derived comparison against the current fingerprint —
// when the error key changes (different failureReason or details), the
// dismissal is automatically lifted without any $effect.
let dismissedErrorKey = $state<string | null>(null);

// Checkpoint timeline state
let showCheckpointTimeline = $state(false);
let isLoadingCheckpoints = $state(false);

// Worktree state - tracks the active worktree directory for checkpoint path conversion
let activeWorktreePath = $state<string | null>(null);
let activeWorktreeOwnerProjectPath = $state<string | null>(null);
let _panelBranch = $state<string | null>(null);
let branchRequestVersion = 0;

// Get checkpoints reactively (loads when needed)
const checkpoints = $derived(sessionId ? checkpointStore.getCheckpoints(sessionId) : []);

function scrollToTop() {
	contentRef?.scrollToTop();
}

function scrollToBottom() {
	// Force: true when user clicks the button - clears anchor
	contentRef?.scrollToBottom({ force: true });
}

function prepareForNextUserReveal() {
	pendingUserRevealRequestVersion += 1;
	logger.info("prepareForNextUserReveal: panel", {
		panelId: effectivePanelId,
		sessionId,
		entryCount: visibleEntryCount,
		requestVersion: pendingUserRevealRequestVersion,
	});
	return effectivePanelId;
}

function scrollToBottomOnTabSwitch() {
	// Returning to the panel resumes live follow for that thread.
	contentRef?.scrollToBottom({ force: true });
}

// Effective panel ID (use prop or generate one)
const effectivePanelId = $derived(panelId ?? "default-panel");
const pendingUserRevealRequestKey = $derived(
	pendingUserRevealRequestVersion === 0
		? null
		: `${effectivePanelId}:${pendingUserRevealRequestVersion}:${optimisticUserEntryForGraph?.id ?? "pending"}`
);

// Derived UI conditions based on projectCount + panel/session state
const showProjectSelection = $derived(
	projectCount !== null && projectCount > 1 && (pendingProjectSelection || project === null)
);
const worktreeToggleProjectPath = $derived(
	resolveWorktreeToggleProjectPath({
		hasSession: sessionId !== null,
		sessionProjectPath,
		selectedProjectPath: project?.path ?? null,
		singleProjectPath: projectCount === 1 ? (allProjects[0]?.path ?? null) : null,
	})
);
const scopedActiveWorktreePath = $derived.by(() => {
	if (!activeWorktreePath) return null;
	if (!worktreeToggleProjectPath) return null;
	return activeWorktreeOwnerProjectPath === worktreeToggleProjectPath ? activeWorktreePath : null;
});
const effectiveActiveWorktreePath = $derived(sessionWorktreePath ?? scopedActiveWorktreePath);
/** True when the session's worktree directory no longer exists on disk. */
let worktreeDeleted = $state(false);
/** Effective git path for runStackedAction: worktree path if in worktree, else project path.
 *  Falls back to the project path when the worktree has been deleted to avoid
 *  repeated failures from git commands targeting a non-existent directory. */
const effectivePathForGit = $derived.by(() => {
	const wt = worktreeDeleted ? null : effectiveActiveWorktreePath;
	return wt ?? worktreeToggleProjectPath ?? null;
});

/** Embedded terminal drawer state. */
const isTerminalDrawerOpen = $derived(
	panelId ? panelStore.isEmbeddedTerminalDrawerOpen(panelId) : false
);

/** Browser sidebar state. */
const showBrowserSidebar = $derived(panelId ? panelStore.isBrowserSidebarExpanded(panelId) : false);
const browserSidebarUrl = $derived(
	panelId ? (panelStore.getHotState(panelId)?.browserSidebarUrl ?? null) : null
);
// Canonical lifecycle presentation from Rust-owned graph projection.
const lifecyclePresentation = $derived(
	sessionId ? sessionStore.getSessionLifecyclePresentation(sessionId) : null
);
const agentPanelCanonicalSource = $derived(
	sessionId ? sessionStore.getSessionAgentPanelCanonicalSource(sessionId) : null
);
const canonicalPanelSessionSource = $derived(
	sessionStore.getSessionAgentPanelSessionSource(sessionId)
);
const canonicalSessionActivity = $derived(
	canonicalPanelSessionSource.kind === "canonical" ? canonicalPanelSessionSource.activity : null
);
const sessionTurnState = $derived(resolveCanonicalAgentPanelTurnState(canonicalPanelSessionSource));
const entriesCount = $derived(knownVisibleEntryCount);
const hasSession = $derived(sessionId !== null);
// Prefer active worktree path, then session worktree, then project paths.
// NOTE: Must be defined before panelVisibility which uses effectiveProjectPath
// When the worktree has been deleted, skip worktree paths so git commands
// target the original project root instead of a non-existent directory.
const effectiveProjectPath = $derived(
	resolveEffectiveProjectPath({
		activeWorktreePath: worktreeDeleted ? null : scopedActiveWorktreePath,
		sessionWorktreePath: worktreeDeleted ? null : sessionWorktreePath,
		sessionProjectPath,
		selectedProjectPath: project?.path,
		singleProjectPath: projectCount === 1 ? allProjects[0].path : undefined,
	})
);
const effectiveProjectName = $derived(
	sessionProjectPath
		? project?.name
		: (project?.name ?? (projectCount === 1 ? allProjects[0].name : undefined))
);
const preSessionSelectedProject = $derived.by(() => {
	if (!worktreeToggleProjectPath) {
		return null;
	}
	return allProjects.find((candidate) => candidate.path === worktreeToggleProjectPath) ?? null;
});

// ✅ Derived values from granular session data
const effectivePanelAgentId = $derived(selectedAgentId ?? sessionAgentId);
const agentName = $derived.by(() => {
	if (!effectivePanelAgentId) {
		return null;
	}

	const agent = availableAgents.find((candidate) => candidate.id === effectivePanelAgentId);
	return agent?.name ?? effectivePanelAgentId;
});
const canonicalPanelSessionState = $derived.by(() =>
	deriveCanonicalAgentPanelSessionState({
		source: canonicalPanelSessionSource,
		hasEntries: hasMessages,
		hasOptimisticPendingEntry: preSessionPendingUserEntry !== null,
		hasLocalPendingSendIntent: sessionPendingSendIntent !== null,
	})
);
const panelSessionStatus = $derived(canonicalPanelSessionState.sessionStatus);
const sessionIsConnected = $derived(canonicalPanelSessionState.isConnected);
const sessionIsStreaming = $derived(canonicalPanelSessionState.isStreaming);
const isAwaitingModelResponse = $derived(canonicalSessionActivity?.kind === "awaiting_model");
const showPlanningIndicator = $derived(canonicalPanelSessionState.showPlanningIndicator);
const sessionCanSubmit = $derived(canonicalPanelSessionState.canSubmit);
const sessionShowStop = $derived(canonicalPanelSessionState.showStop);
const sessionConnectionError = $derived(
	sessionId ? sessionStore.getSessionConnectionError(sessionId) : null
);
const sessionFailureReason = $derived(
	sessionId ? sessionStore.getSessionLifecycleFailureReason(sessionId) : null
);
const activeTurnError = $derived.by(() => {
	const activeTurnFailure = sessionId ? sessionStore.getSessionActiveTurnFailure(sessionId) : null;
	if (activeTurnFailure) {
		return {
			content: activeTurnFailure.message,
			code: activeTurnFailure.code ?? undefined,
			kind: activeTurnFailure.kind,
			source: activeTurnFailure.source,
		};
	}

	return null;
});
const disableSendForFailedFirstSend = $derived(
	panelConnectionState
		? shouldDisableSendForFailedFirstSend({
				hasSession: Boolean(sessionId),
				panelConnectionState,
			})
		: false
);
const errorInfo = $derived.by(() =>
	derivePanelErrorInfo({
		panelConnectionState,
		panelConnectionError,
		sessionConnectionError,
		sessionTurnState: sessionTurnState,
		activeTurnError,
		sessionFailureReason,
		agentDisplayName: agentName,
	})
);
// Deterministic local reference id derived purely from error content.
// When `errorInfo.referenceId` exists (panel-level error with an upstream id),
// we use it directly; otherwise we mint a stable id from the (title, details)
// fingerprint so the same error keeps the same id without an $effect.
const fallbackInlineErrorReferenceId = $derived.by(() => {
	if (!errorInfo.showError || errorInfo.details === null) {
		return null;
	}
	if (errorInfo.referenceId !== null) {
		return null;
	}
	return deriveLocalReferenceId(`${errorInfo.title}|${errorInfo.details}`);
});
const inlineErrorReferenceId = $derived(errorInfo.referenceId ?? fallbackInlineErrorReferenceId);
const inlineErrorReferenceSearchable = $derived(
	errorInfo.referenceId !== null ? errorInfo.referenceSearchable : false
);

// Dismissal key: errors with the same (failureReason, details) pair are the
// same logical error; if the user dismisses one, they dismiss the same error
// across reactive reads. New failureReason or new details ⇒ new key ⇒ the
// dismissal is automatically lifted (no $effect needed).
const errorDismissalKey = $derived(
	errorInfo.showError ? `${errorInfo.failureReason ?? "none"}::${errorInfo.details ?? ""}` : null
);
const errorDismissed = $derived(
	errorDismissalKey !== null && dismissedErrorKey === errorDismissalKey
);

// Panel view state: single discriminated union from all inputs
const viewStateInput = $derived({
	lifecyclePresentation,
	entriesCount,
	hasSession,
	isAwaitingModelResponse,
	hasImmediatePendingSendIntent,
	showProjectSelection,
	hasEffectiveProjectPath: !!effectiveProjectPath,
	errorInfo,
});
const viewState = $derived(derivePanelViewState(viewStateInput));
const panelViewKind = $derived(viewState.kind);

// Suppress the inline error card when the big-page error variant is
// rendering for the same failure — otherwise the user sees the duplicated
// "Unable to load session" page AND a red inline card. The big page is
// the primary treatment when there are no entries; the inline card is
// the single surface inside an active conversation.
const showInlineErrorCard = $derived(
	errorInfo.showError && !errorDismissed && viewState.kind !== "error"
);
const worktreePending = $derived(
	resolveAgentPanelWorktreePending({
		activeWorktreePath: effectiveActiveWorktreePath,
		hasMessages,
		pendingWorktreeEnabled: panelPendingWorktreeEnabled,
		hasPreparedWorktreeLaunch: panelPreparedWorktreeLaunch !== null,
	})
);
let worktreeSetupState = $state<WorktreeSetupState | null>(null);
const pendingWorktreeSetup = $derived(panelHotState ? panelHotState.pendingWorktreeSetup : null);
const showPreSessionWorktreeCard = $derived.by(() =>
	shouldShowPreSessionWorktreeCard({
		sessionId,
		pendingProjectSelection,
		worktreeToggleProjectPath,
		hasPendingWorktreeSetup: pendingWorktreeSetup !== null,
		worktreeSetupVisible: worktreeSetupState?.isVisible === true,
		hasMessages,
	})
);

$effect(() => {
	if (!import.meta.env.DEV) return;
	logger.info("[first-send-trace] panel render gate", {
		panelId: effectivePanelId,
		sessionId: sessionId ?? null,
		viewState: viewState.kind,
		pendingUserEntry: panelId ? panelStore.getHotState(panelId).pendingUserEntry !== null : false,
		entriesCount: knownVisibleEntryCount,
		hasSession: sessionId !== null,
		t_ms: Math.round(performance.now()),
	});
});

$effect(() => {
	if (!import.meta.env.DEV) return;
	const signature = JSON.stringify({
		panelId,
		sessionId,
		viewState: viewState.kind,
		entryCount: visibleEntryCount,
	});
	if (signature === lastPanelTraceSignature) {
		return;
	}
	lastPanelTraceSignature = signature;
	logger.info("agent panel state changed", JSON.parse(signature) as object);
});

$effect(() => {
	if (!import.meta.env.DEV) return;
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
	if (!import.meta.env.DEV) return;
	logger.info("[worktree-flow] worktree path chain", {
		activeWorktreePath,
		worktreeToggleProjectPath,
		activeWorktreeOwnerProjectPath,
		scopedActiveWorktreePath,
		sessionWorktreePath,
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
		worktreeSetupState = createWorktreeCreationState({
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
		worktreeSetupState = reduceWorktreeSetupEvent(worktreeSetupState, payload);
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
	const state = worktreeSetupState;
	if (!state) return;

	if (worktreeSetupMatchContext.worktreePaths.length > 0) {
		if (
			!state.worktreePath ||
			!worktreeSetupMatchContext.worktreePaths.includes(state.worktreePath)
		) {
			worktreeSetupState = null;
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
		worktreeSetupState = null;
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

const sequenceId = $derived(sessionMetadata ? (sessionMetadata.sequenceId ?? null) : null);

const displayTitle = $derived.by(() => {
	return deriveAgentPanelHeaderDisplayTitle({
		sessionTitle,
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
const sessionCreatedAt = $derived(sessionMetadata?.createdAt ?? null);
const sessionUpdatedAt = $derived(sessionMetadata?.updatedAt ?? null);
const graphSceneMaterializer = createAgentPanelGraphMaterializerReadModel();

const effectivePanelProviderBrand = $derived.by(() => {
	const headerAgentId = sessionAgentId ?? effectivePanelAgentId;
	if (!headerAgentId) {
		return null;
	}

	const sessionProviderBrand =
		sessionId === null ? null : (sessionStore.getSessionProviderMetadata(sessionId)?.providerBrand ?? null);
	const storeProviderBrand =
		agentStore.getProviderMetadata(headerAgentId)?.providerBrand ?? null;
	const listedProviderBrand =
		availableAgents.find((agent) => agent.id === headerAgentId)?.provider_metadata
			?.providerBrand ?? null;

	return resolveAgentPanelProviderBrand({
		agentId: headerAgentId,
		sessionProviderBrand,
		storeProviderBrand,
		listedProviderBrand,
	});
});
const agentIconSrc = $derived(getProviderBrandIcon(effectivePanelProviderBrand, effectiveTheme));
const graphMaterializedScene = $derived(
	graphSceneMaterializer.apply({
		panelId: effectivePanelId,
		graph: agentPanelCanonicalSource,
		header: {
			title: graphHeaderTitle,
			subtitle: sessionTitle,
			agentIconSrc,
			agentLabel: agentName,
			projectLabel: displayProjectName,
			projectColor,
			sequenceId,
		},
		optimistic:
			optimisticUserEntryForGraph != null
				? {
						pendingUserEntry: optimisticUserEntryForGraph,
					}
				: null,
	})
);
const agentPanelBaseDisplayModel = $derived(
	buildAgentPanelBaseModel({
		panelId: effectivePanelId,
		graph: agentPanelCanonicalSource,
		header: {
			title: graphHeaderTitle,
			agentName,
		},
		sceneEntries: graphMaterializedScene.conversation.entries,
		rows: agentPanelDisplayRowsReadModel,
		local: {
			pendingSendIntent: hasImmediatePendingSendIntent,
		},
	})
);
const agentPanelDisplayResult = $derived.by(() => {
	const result = applyAgentPanelDisplayMemory(agentPanelDisplayMemory, agentPanelBaseDisplayModel);
	agentPanelDisplayMemory = result.memory;
	return result;
});
const agentPanelDisplayModel = $derived(agentPanelDisplayResult.model);
const graphSceneEntries = $derived.by(() => {
	const input = {
		model: agentPanelDisplayModel,
		memory: agentPanelDisplayResult.memory,
		sceneEntries: graphMaterializedScene.conversation.entries,
	};
	return (
		agentPanelDisplaySceneEntriesReadModel.applyPatch(input) ??
		agentPanelDisplaySceneEntriesReadModel.apply(input)
	);
});
const tokenRevealSceneEntries = $derived.by(() => {
	tokenRevealSettleRevision;
	const streamingAnimationMode = chatPreferencesStore?.streamingAnimationMode ?? "smooth";
	const tokenRevealTailRowId =
		sessionId === null ? null : sessionStore.getActiveStreamingTailRowId(sessionId);
	const clockAnchor = sessionId === null ? null : sessionStore.getClockAnchor(sessionId);

	tokenRevealSourceIndexReadModel.applyPatch(graphMaterializedScene.conversation.entries) ??
		tokenRevealSourceIndexReadModel.applySnapshot(graphMaterializedScene.conversation.entries);
	const tailEntry =
		tokenRevealSourceIndexReadModel.selectEntryById(tokenRevealTailRowId);
	const tailEntryIndex =
		tokenRevealSourceIndexReadModel.selectEntryIndexById(tokenRevealTailRowId);
	const tokenRevealCss =
		tailEntry?.type === "assistant"
			? buildTokenRevealCss(
					sessionId === null
						? null
						: sessionStore.getRowTokenStreamByRowId(sessionId, tailEntry.id),
					clockAnchor,
					streamingAnimationMode,
					prefersReducedMotion,
					tailEntry.isStreaming === true
				)
			: undefined;
	const tokenRevealSnapshot = {
		sceneEntries: graphSceneEntries,
		sourceEntry: tailEntry,
		tailRowId: tokenRevealTailRowId,
		tailRowIndex: tailEntryIndex,
		tokenRevealCss,
	};

	return (
		tokenRevealSceneReadModel.applyPatch(tokenRevealSnapshot) ??
		tokenRevealSceneReadModel.applySnapshot(tokenRevealSnapshot)
	);
});
const tokenRevealSettleDelayMs = $derived(
	resolveTokenRevealSettleDelayMs(tokenRevealSceneReadModel.selectSettlingTimings())
);
$effect(() => {
	const delayMs = tokenRevealSettleDelayMs;
	if (delayMs === null) {
		return;
	}

	const nextRevision = tokenRevealSettleRevision + 1;
	const timeoutId = window.setTimeout(() => {
		if (tokenRevealSettleRevision < nextRevision) {
			tokenRevealSettleRevision = nextRevision;
		}
	}, delayMs);

	return () => {
		window.clearTimeout(timeoutId);
	};
});
const isConnecting = $derived(
	panelConnectionState === PanelConnectionState.CONNECTING ||
		(!sessionId && panelId ? panelHotState?.pendingUserEntry !== null : false)
);
const inputRenderKey = $derived(
	`${panelId ?? "no-panel"}:${panelHotState?.composerRestoreVersion ?? 0}`
);
const branchLookupPath = $derived(
	(worktreeDeleted ? null : effectiveActiveWorktreePath) ?? effectiveProjectPath ?? null
);
const _activeWorktreeName = $derived.by(() => {
	const worktreePath = effectiveActiveWorktreePath;
	if (!worktreePath) return null;
	const segments = worktreePath.split("/").filter((segment) => segment.length > 0);
	return segments.length > 0 ? (segments[segments.length - 1] ?? null) : null;
});
const footerWorktreeStatus = $derived.by(() => {
	if (!sessionId || !worktreeToggleProjectPath) {
		return null;
	}

	if (effectiveActiveWorktreePath && _activeWorktreeName) {
		return {
			mode: "worktree" as const,
			primaryLabel: _activeWorktreeName,
			secondaryLabel: null,
		};
	}

	return null;
});

/** Minimal linked-session references for the modified-header PR picker. */
const projectPrLinkReferences = $derived.by(() => {
	if (!sessionProjectPath) return [];
	return sessionStore.getSessionPrLinkReferencesForProject(sessionProjectPath);
});

/** Project matching the current session, used to render project-letter badges in the PR picker. */
const projectForPr = $derived.by(() => {
	if (!sessionProjectPath) return null;
	return allProjects.find((p) => p.path === sessionProjectPath) ?? null;
});

const hasPlan = $derived(planState.plan !== null);
const ATTACHED_COLUMN_WIDTH = 450;
const PLAN_SIDEBAR_COLUMN_WIDTH = 450;
const BROWSER_SIDEBAR_COLUMN_WIDTH = 500;
const ATTACHED_COLUMN_GAP_WIDTH = 2;

// Dynamic minimum width reported by the toolbar's intrinsic content measurement.
// The 16px accounts for the data-input-area wrapper's p-2 padding (8px each side).
let toolbarMinWidth = $state(0);
let createPrRunning = $state(false);
let createPrLabel = $state<string | null>(null);
let mergePrRunning = $state(false);
let prDetails = $state<import("$lib/utils/tauri-client/git.js").PrDetails | null>(null);
let prFetchError = $state<string | null>(null);
let streamingShipData = $state<import("../../ship-card/ship-card-parser.js").ShipCardData | null>(
	null
);
let prCardRenderKey = $state(0);
let preSessionWorktreeFailure = $state<string | null>(null);
let agentInputRef = $state<{
	retrySend: () => void;
	restoreQueuedMessage: (draft: string, attachments: readonly Attachment[]) => void;
} | null>(null);
let isRetryingConnection = $state(false);
let retryBusyTimer: ReturnType<typeof setTimeout> | null = null;
let headerRef: HTMLElement | undefined = $state();

onDestroy(() => {
	if (retryBusyTimer !== null) {
		clearTimeout(retryBusyTimer);
		retryBusyTimer = null;
	}
});

const worktreeSetupMatchContext = $derived.by(() => {
	const activeSetupState = worktreeSetupState?.isVisible ? worktreeSetupState : null;

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
const createdPr = $derived(sessionMetadata?.prNumber ?? null);

const prFetchTarget = $derived.by(() => {
	if (!sessionId || !sessionProjectPath || createdPr == null) {
		return null;
	}

	return {
		sessionId,
		projectPath: sessionProjectPath,
		prNumber: createdPr,
	};
});

void mergeStrategyStore.initialize();

/**
 * Fetch PR details from GitHub. Called imperatively:
 * - When the current session exposes a PR number
 * - After PR creation succeeds
 * - After PR merge (to refresh state)
 * The store's prState update is handled by sessionStore.refreshSessionPrState.
 */
function fetchPrDetails(target: {
	sessionId: string;
	projectPath: string;
	prNumber: number;
}): void {
	prDetails = null;
	prFetchError = null;
	void sessionStore
		.refreshSessionPrState(target.sessionId, target.projectPath, target.prNumber)
		.match(
			(details) => {
				prDetails = details;
			},
			() => {
				// refreshSessionPrState never errors (orElse swallows), but match requires both branches
			}
		);
}

let lastFetchedPrTargetKey = $state<string | null>(null);
$effect(() => {
	if (!prFetchTarget) {
		prDetails = null;
		prFetchError = null;
		lastFetchedPrTargetKey = null;
		return;
	}

	const targetKey = `${prFetchTarget.sessionId}:${prFetchTarget.projectPath}:${prFetchTarget.prNumber}`;
	if (targetKey === lastFetchedPrTargetKey) {
		return;
	}

	lastFetchedPrTargetKey = targetKey;
	fetchPrDetails(prFetchTarget);
});

const toolbarMinWidthWithPadding = $derived(toolbarMinWidth > 0 ? toolbarMinWidth + 16 : 0);
const hasAttachedPane = $derived(Boolean(panelId) && hasAttachedFilePane);
const requiredSplitWidth = $derived(
	hasAttachedPane ? ATTACHED_COLUMN_WIDTH * 2 + ATTACHED_COLUMN_GAP_WIDTH : 0
);
const panelRenderWidth = $derived(hasAttachedPane ? requiredSplitWidth : width);
const centeredFullscreenContent = $derived.by(() =>
	shouldUseCenteredFullscreenContent({
		hasAttachedPane,
		isFullscreen,
	})
);
const agentContentColumnStyle = $derived.by(() =>
	resolveAgentContentColumnStyle({
		hasAttachedPane,
		isFullscreen,
		attachedColumnWidth: ATTACHED_COLUMN_WIDTH,
	})
);

// Ensure panel is never narrower than the toolbar's natural content width
const baseWidth = $derived(Math.max(panelRenderWidth, toolbarMinWidthWithPadding));

// Clamp reviewFileIndex to valid bounds so a stale index never leaves review mode empty.
const clampedReviewFileIndex = $derived.by(() => {
	const fileCount = reviewFilesState?.fileCount ?? 0;
	if (fileCount === 0) return 0;
	return Math.min(reviewFileIndex, fileCount - 1);
});

let reviewDialogOpen = $state(false);
let reviewDialogFilesState = $state<ModifiedFilesState | null>(null);
let reviewDialogFileIndex = $state(0);
let reviewDialogControls = $state<ReviewControlsSnapshot | null>(null);

function handleReviewDialogControlsChange(controls: ReviewControlsSnapshot | null): void {
	reviewDialogControls = controls;
}

const clampedReviewDialogFileIndex = $derived.by(() => {
	const fileCount = reviewDialogFilesState?.fileCount ?? 0;
	if (fileCount === 0) return 0;
	return Math.min(Math.max(reviewDialogFileIndex, 0), fileCount - 1);
});
const reviewDialogDiffStats = $derived.by(() => {
	if (!reviewDialogFilesState) {
		return { insertions: 0, deletions: 0 };
	}

	return reviewDialogFilesState.files.reduce(
		(totals, file) => ({
			insertions: totals.insertions + file.totalAdded,
			deletions: totals.deletions + file.totalRemoved,
		}),
		{ insertions: 0, deletions: 0 }
	);
});

// Add embedded pane widths (plan sidebar, review) when expanded
const effectiveWidth = $derived.by(() =>
	resolveAgentPanelEffectiveWidth({
		baseWidth,
		reviewMode,
		showPlanSidebar,
		hasPlan,
		planSidebarColumnWidth: PLAN_SIDEBAR_COLUMN_WIDTH,
		showBrowserSidebar,
		browserSidebarColumnWidth: BROWSER_SIDEBAR_COLUMN_WIDTH,
	})
);

// In fullscreen mode, always use 100% width (sidebar shares space within the panel)
// In non-fullscreen mode, double the width when sidebar is open so both halves fit
const widthStyle = $derived.by(() =>
	resolveAgentPanelWidthStyle({
		effectiveWidth,
		isFullscreen,
	})
);

// Debug state for panel debugging (inert in production — deps behind early return are not tracked)
const debugPanelState = $derived.by(() => {
	if (!import.meta.env.DEV) return null;
	return {
		// Panel identification
		panelId: effectivePanelId,
		// Panel state
		isFullscreen,
		isFocused,
		// Session state
		hasSession: sessionId !== null,
		sessionId,
		sessionTitle,
		sessionStatus: panelSessionStatus,
		sessionProjectPath,
		sessionAgentId,
		selectedAgentId,
		// Loading states
		isWaitingForSession,
		pendingProjectSelection,
		// Project info
		projectCount,
		projectName: project?.name,
		projectPath: project?.path,
		// UI conditions
		viewStateKind: viewState.kind,
		// Available agents
		availableAgentsCount: availableAgents.length,
		availableAgentIds: availableAgents.map((a) => a.id),
		// Plan state
		hasPlan,
		planTitle: planState.plan?.title,
		// Dimensions
		width,
		widthStyle,
		// Theme
		effectiveTheme,
	};
});

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
	return sessionStore.getSessionModifiedFilesState(sessionId);
});

function handleEnterReviewMode(filesState: ModifiedFilesState): void {
	onEnterReviewMode?.(filesState, resolveInitialReviewWorkspaceIndex(filesState, sessionId));
}

function openReviewDialogAtInitialFile(filesState: ModifiedFilesState): void {
	reviewDialogFilesState = filesState;
	reviewDialogFileIndex = resolveInitialReviewWorkspaceIndex(filesState, sessionId);
	reviewDialogOpen = true;
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

function handleReviewDialogOpenChange(open: boolean): void {
	reviewDialogOpen = open;
	if (open) {
		return;
	}
	reviewDialogFilesState = null;
	reviewDialogFileIndex = 0;
}

// Track panelId changes for tab switching detection
let lastPanelId = $state<string | undefined>(undefined);

// Restore review mode when session loads (deferred from workspace restore)
$effect(() => {
	if (
		!panelId ||
		!sessionId ||
		visibleEntryCount === null ||
		visibleEntryCount === 0 ||
		reviewMode
	) {
		return;
	}

	const pendingFileIndex = panelStore.consumePendingReviewRestore(panelId);
	if (pendingFileIndex === null) return;

	if (!modifiedFilesState) return;

	onEnterReviewMode?.(modifiedFilesState, pendingFileIndex);
});

$effect(() => {
	if (!panelId) {
		panelConnectionState = null;
		panelConnectionError = null;
		return;
	}

	const existingState = connectionStore.getState(panelId);
	const existingContext = connectionStore.getContext(panelId);
	panelConnectionState = existingState;
	panelConnectionError = existingContext?.error ?? null;

	const unsubscribe = connectionStore.onChange((id, state, context) => {
		if (id !== panelId) return;
		panelConnectionState = state;
		panelConnectionError = context.error ?? null;
	});

	return () => {
		unsubscribe();
	};
});

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

// ✅ Worktree close confirmation (inline header strip)
let worktreeCloseConfirming = $state(false);
let worktreeHasDirtyChanges = $state(false);
let worktreeDirtyCheckPending = $state(false);

// Check if the session's worktree still exists on disk.
// If deleted, disconnect the session (agent can't work in a missing directory).
$effect(() => {
	const worktreePath = sessionWorktreePath;
	const projectPath = sessionProjectPath;
	const currentSessionId = sessionId;
	if (!worktreePath || !projectPath) {
		worktreeDeleted = false;
		return;
	}
	let disposed = false;
	void fetchWorktreePathListedForProject(projectPath, worktreePath).match(
		(listed) => {
			if (disposed) return;
			if (!listed) {
				worktreeDeleted = true;
				if (currentSessionId) {
					sessionStore.disconnectSession(currentSessionId);
				}
			} else {
				worktreeDeleted = false;
			}
		},
		() => {
			if (disposed) return;
			worktreeDeleted = true;
			if (currentSessionId) {
				sessionStore.disconnectSession(currentSessionId);
			}
		}
	);
	return () => {
		disposed = true;
	};
});

// ✅ Event handlers - can access current props directly
async function handleClose() {
	if (
		shouldConfirmWorktreeClose({
			bypassConfirmation: bypassWorktreeCloseConfirmation,
			worktreePath: effectiveActiveWorktreePath,
			worktreeDeleted,
		})
	) {
		const worktreePath = effectiveActiveWorktreePath;
		if (worktreePath == null) {
			return;
		}
		const confirmationState = createPendingWorktreeCloseConfirmationState();
		worktreeCloseConfirming = confirmationState.confirming;
		worktreeHasDirtyChanges = confirmationState.hasDirtyChanges;
		worktreeDirtyCheckPending = confirmationState.dirtyCheckPending;
		const hasDirtyChanges = await fetchWorktreeHasUncommittedChanges(worktreePath).match(
			(dirty) => dirty,
			() => false // safe default on error — show normal confirmation
		);
		const resolvedState = createResolvedWorktreeCloseConfirmationState(hasDirtyChanges);
		worktreeCloseConfirming = resolvedState.confirming;
		worktreeHasDirtyChanges = resolvedState.hasDirtyChanges;
		worktreeDirtyCheckPending = resolvedState.dirtyCheckPending;
		return;
	}
	onClose?.();
}

export function requestClosePanelConfirmation(): void {
	void handleClose();
}

function handleWorktreeCloseOnly() {
	worktreeCloseConfirming = false;
	worktreeDirtyCheckPending = false;
	onClose?.();
}

function handleWorktreeRemoveAndClose() {
	const worktreePath = effectiveActiveWorktreePath;
	const currentSessionId = sessionId;
	const force = worktreeHasDirtyChanges;
	worktreeCloseConfirming = false;
	worktreeDirtyCheckPending = false;
	onClose?.();
	void removeWorktreeAndMarkSessionWorktreeDeleted(
		{
			force,
			sessionId: currentSessionId,
			worktreePath,
		},
		{
			removeWorktree: (path, shouldForce) => removeWorktreeFromDisk(path, shouldForce),
			markSessionWorktreeDeleted: (id) => {
				sessionStore.updateSession(id, { worktreeDeleted: true });
			},
			clearSessionWorktreeDeleted: (id) => {
				sessionStore.updateSession(id, { worktreeDeleted: false });
			},
			disconnectSession: (id) => {
				sessionStore.disconnectSession(id);
			},
		}
	).mapErr((error) => {
		console.error("[AgentPanel] Failed to remove worktree", { error });
		toast.error(`Failed to remove worktree: ${error.message}`);
	});
}

function handleWorktreeCloseCancel() {
	worktreeCloseConfirming = false;
	worktreeHasDirtyChanges = false;
	worktreeDirtyCheckPending = false;
}

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
	preSessionWorktreeFailure = null;
	onSessionCreated?.(sessionIdParam);
}

function handleWorktreeCreated(info: WorktreeInfo | string) {
	const nextDirectory = typeof info === "string" ? info : info.directory;
	preSessionWorktreeFailure = null;
	activeWorktreePath = nextDirectory;
	activeWorktreeOwnerProjectPath = worktreeToggleProjectPath;

	const projectPath = sessionProjectPath ?? worktreeToggleProjectPath ?? "";
	logger.info("[worktree-flow] handleWorktreeCreated: entry", {
		sessionId: sessionId ?? null,
		sessionProjectPath,
		worktreeToggleProjectPath,
		projectPath: projectPath || null,
		infoDirectory: nextDirectory,
	});
	if (!projectPath) {
		logger.info("[worktree-flow] handleWorktreeCreated: early return (no projectPath)");
		return;
	}
	logger.info("[worktree-flow] handleWorktreeCreated: set activeWorktreePath", {
		activeWorktreePath: nextDirectory,
		projectPath,
	});

	if (sessionId) {
		sessionStore.updateSession(sessionId, {
			worktreeDeleted: false,
			worktreePath: nextDirectory,
		});
	}
}

function handlePreparedWorktreeLaunch(
	launch: import("$lib/acp/types/worktree-info.js").PreparedWorktreeLaunch
): void {
	preSessionWorktreeFailure = null;
	if (panelId) {
		panelStore.setPreparedWorktreeLaunch(panelId, launch);
	}
	activeWorktreePath = launch.worktree.directory;
	activeWorktreeOwnerProjectPath = worktreeToggleProjectPath;
}

function handlePreSessionWorktreeFailure(message: string): void {
	preSessionWorktreeFailure = message;
}

function handleRetryWorktree(): void {
	preSessionWorktreeFailure = null;
	agentInputRef?.retrySend();
}

function handleStartInProjectRoot(): void {
	preSessionWorktreeFailure = null;
	if (panelId && panelPreparedWorktreeLaunch) {
		void discardPreparedWorktreeSessionLaunch(panelPreparedWorktreeLaunch.launchToken, true).match(
			() => {
				activeWorktreePath = null;
				activeWorktreeOwnerProjectPath = null;
				panelStore.clearPreparedWorktreeLaunch(panelId);
				panelStore.setPendingWorktreeEnabled(panelId, false);
			},
			(error) => {
				toast.error(`Failed to discard prepared worktree: ${error.message}`);
			}
		);
		return;
	}
	activeWorktreePath = null;
	activeWorktreeOwnerProjectPath = null;
	if (panelId) {
		panelStore.setPendingWorktreeEnabled(panelId, false);
	}
}

function handleWorktreeRenamed(info: WorktreeInfo): void {
	activeWorktreePath = info.directory;
	activeWorktreeOwnerProjectPath = worktreeToggleProjectPath ?? sessionProjectPath ?? null;

	if (!sessionId) {
		return;
	}

	sessionStore.updateSession(sessionId, {
		worktreeDeleted: false,
		worktreePath: info.directory,
	});

	void persistSessionWorktreePathAfterRename(
		sessionId,
		info.directory,
		sessionProjectPath ? sessionProjectPath : undefined,
		sessionAgentId ? sessionAgentId : undefined
	).mapErr((error) => {
		logger.error("Failed to persist renamed worktree path to DB", {
			sessionId,
			worktreePath: info.directory,
			error,
		});
	});
}

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
		setCreatePrRunning: (running) => {
			createPrRunning = running;
		},
		setCreatePrLabel: (label) => {
			createPrLabel = label;
		},
		onStreamReset: () => {
			streamingShipData = null;
		},
		onStreamUpdate: (data) => {
			const hadPreviewContent = hasStreamingPreviewContent(streamingShipData);
			const hasPreviewContent = hasStreamingPreviewContent(data);
			if (!hadPreviewContent && hasPreviewContent) {
				prCardRenderKey += 1;
			}
			streamingShipData = data;
		},
		deps: {
			applyAutomaticSessionPrLink: async (id, projectPath, pr) => {
				const result = await sessionStore.applyAutomaticPrLinkFromShipWorkflow(id, projectPath, pr);
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
		setMergePrRunning: (running) => {
			mergePrRunning = running;
		},
		onMerged: () => {
			sessionStore.updateSession(sessionId, { prState: "MERGED" });
			sessionStore.invalidatePrDetails(path, prNum);
			fetchPrDetails({
				sessionId,
				projectPath: path,
				prNumber: prNum,
			});
		},
	});
}

async function handleCopyContent() {
	if (!sessionId) {
		toast.error("No thread to copy");
		return;
	}
	await copyThreadContentToClipboard({
		sessionId,
		getSessionJsonExportContent: (id) => sessionStore.getSessionJsonExportContent(id),
	});
}

async function handleOpenInFinder() {
	await openSessionInFinder({
		sessionId,
		projectPath: sessionProjectPath,
		agentId: sessionAgentId,
		sourcePath: sessionMetadata?.sourcePath ?? null,
	});
}

async function handleExportRawStreaming() {
	await openStreamingLog(sessionId);
}

async function handleCopyStreamingLogPath() {
	await copyStreamingLogPathToClipboard({ sessionId, logger });
}

async function handleOpenRawFile() {
	await openSessionRawFileInEditor({ sessionId, sessionProjectPath });
}

async function handleOpenInAcepe() {
	await openSessionFileInAcepePanel({
		sessionId,
		sessionProjectPath,
		effectivePanelId,
		openFilePanel: (fileName, dirPath, opts) => panelStore.openFilePanel(fileName, dirPath, opts),
	});
}

async function handleExportMarkdown(): Promise<void> {
	if (!sessionId) return;
	await sessionStore.getSessionMarkdownExportContent(sessionId).match(
		(markdown) => exportSessionMarkdownToClipboard(markdown),
		(error) => {
			toast.error(error.message);
		}
	);
}

async function handleExportJson() {
	if (!sessionId) return;
	await exportSessionJsonToClipboard({
		sessionId,
		getSessionJsonExportContent: (id) => sessionStore.getSessionJsonExportContent(id),
	});
}

function handlePanelClick(e: MouseEvent) {
	const target = e.target as HTMLElement;

	// Don't focus panel if clicking on input area or form elements
	// Check data-input-area first (most common case) to avoid unnecessary DOM traversal
	const isInputArea =
		target.hasAttribute("data-input-area") || target.closest("[data-input-area]") !== null;
	const isTextarea = target.tagName === "TEXTAREA" || target.closest("textarea") !== null;
	const isInput = target.tagName === "INPUT" || target.closest("input") !== null;
	// Only check for actual <button> and <a> elements, not role="button" which is used
	// for accessibility on collapsible containers
	const isButton = target.closest("button") !== null;
	const isLink = target.closest("a") !== null;

	if (isInputArea || isTextarea || isInput || isButton || isLink) {
		// Don't focus the panel when clicking on form elements or buttons
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
	if (isRetryingConnection) {
		return;
	}
	isRetryingConnection = true;
	if (retryBusyTimer !== null) {
		clearTimeout(retryBusyTimer);
	}
	// Auto-clear after a short window so the spinner doesn't hang forever
	// if the underlying state machine doesn't bounce. The state-driven
	// reactive clear below also resets it as soon as the error/turn state
	// transitions away from the failure.
	retryBusyTimer = setTimeout(() => {
		isRetryingConnection = false;
		retryBusyTimer = null;
	}, 4000);

	// Turn-level failure on an existing session: re-send the last user
	// message in the same session instead of recreating the session.
	// Recreating throws away the bound session and the user sees no change.
	const isTurnFailure =
		sessionId !== null && (activeTurnError !== null || sessionTurnState === "error");
	if (isTurnFailure && agentInputRef) {
		agentInputRef.retrySend();
		return;
	}

	runPanelConnectionRetry({
		sessionId,
		panelId: panelId ?? undefined,
		panelConnectionState,
		project,
		effectivePanelAgentId,
		onClearErrorDismissed: () => {
			dismissedErrorKey = null;
		},
		onSendCancelToPanel: (id) => {
			connectionStore.send(id, { type: PanelConnectionEvent.CANCEL });
		},
		onRecreateSession: (proj, agentId) => {
			void installAgentThenCreateSession(proj, agentId);
		},
		logContext: {
			panelId: effectivePanelId,
			projectPath: project?.path,
			agentId: effectivePanelAgentId,
		},
	});
}

// Clear the retry busy flag as soon as the underlying state advances
// (turn becomes non-failed, error info clears, or panel reconnects).
$effect(() => {
	const stillFailed =
		errorInfo.showError ||
		activeTurnError !== null ||
		sessionTurnState === "error" ||
		panelConnectionState === PanelConnectionState.ERROR;
	if (!stillFailed && isRetryingConnection) {
		isRetryingConnection = false;
		if (retryBusyTimer !== null) {
			clearTimeout(retryBusyTimer);
			retryBusyTimer = null;
		}
	}
});

function handleCancelConnection() {
	// For now, just show a message that cancellation is not implemented
	// In the future, this could cancel any pending session creation
	toast.info("Connection cancellation not yet implemented.");
}

function handleDismissError() {
	dismissedErrorKey = errorDismissalKey;
}

function handleCopyInlineErrorReference() {
	const referenceId = inlineErrorReferenceId;
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
		errorInfo.details ?? panelConnectionError?.message ?? sessionConnectionError ?? "Unknown error";
	const summary = errorInfo.summary ?? details.split("\n")[0]?.slice(0, 120) ?? "Agent error";
	return buildAgentErrorIssueDraft({
		agentId: effectivePanelAgentId ?? "unknown",
		sessionId,
		projectPath: sessionProjectPath,
		worktreePath: sessionWorktreePath,
		errorSummary: summary,
		errorDetails: details,
		referenceId: inlineErrorReferenceId,
		referenceSearchable: inlineErrorReferenceSearchable,
		diagnosticsSummary: errorInfo.summary,
		sessionTitle,
		sessionCreatedAt,
		sessionUpdatedAt,
		currentModelId: sessionCurrentModelId,
		entryCount: visibleEntryCount,
		panelConnectionState: panelConnectionState?.toString() ?? null,
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

async function handleToggleCheckpointTimeline() {
	if (!sessionId) return;

	if (!showCheckpointTimeline) {
		isLoadingCheckpoints = true;
		await loadCheckpointsBeforeTimelineOpen(sessionId);
		isLoadingCheckpoints = false;
	}
	showCheckpointTimeline = !showCheckpointTimeline;
}

function handleCloseCheckpointTimeline() {
	showCheckpointTimeline = false;
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
		toolCalls: sessionStore.getSessionToolCalls(sessionId),
		isConnected: sessionIsConnected,
		status: panelSessionStatus,
		isStreaming: sessionIsStreaming,
	};
	const result = todoManager.getTodoStateFromToolCalls(sessionId, threadData);
	return result.isOk() ? result.value : null;
});
const showTodoHeader = $derived(todoState !== null && todoState.totalCount > 0);

function getTodoMarkdown(): string {
	if (!todoState) return "";
	const header = "| # | Task | Status | Duration |";
	const separator = "|---|------|--------|----------|";
	const rows = todoState.items.map((todo, index) => {
		const num = index + 1;
		const statusLabel =
			todo.status === "completed"
				? "Done"
				: todo.status === "in_progress"
					? "Running"
					: todo.status === "cancelled"
						? "Cancelled"
						: "Pending";
		const durationMs = todo.duration;
		let duration = "";
		if (durationMs !== null && durationMs !== undefined) {
			const seconds = Math.floor(durationMs / 1000);
			if (seconds < 60) duration = `${seconds}s`;
			else {
				const minutes = Math.floor(seconds / 60);
				const remainingSeconds = seconds % 60;
				if (minutes < 60) duration = `${minutes}m ${remainingSeconds}s`;
				else {
					const hours = Math.floor(minutes / 60);
					const remainingMinutes = minutes % 60;
					duration = `${hours}h ${remainingMinutes}m`;
				}
			}
		}
		return `| ${num} | ${todo.content} | ${statusLabel} | ${duration} |`;
	});
	return [header, separator, ...rows].join("\n");
}

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

function handlePreSessionWorktreeYes(): void {
	preSessionWorktreeFailure = null;
	const store = getWorktreeDefaultStore();
	if (store.globalDefault) {
		void store.set(false);
	}
	if (panelId) {
		panelStore.setPendingWorktreeEnabled(panelId, true);
	}
}

function handlePreSessionWorktreeNo(): void {
	preSessionWorktreeFailure = null;
	const store = getWorktreeDefaultStore();
	if (store.globalDefault) {
		void store.set(false);
	}
	if (panelId) {
		if (panelPreparedWorktreeLaunch) {
			void discardPreparedWorktreeSessionLaunch(
				panelPreparedWorktreeLaunch.launchToken,
				true
			).match(
				() => {
					panelStore.clearPreparedWorktreeLaunch(panelId);
				},
				(error) => {
					toast.error(`Failed to discard prepared worktree: ${error.message}`);
				}
			);
		}
		panelStore.setPendingWorktreeEnabled(panelId, false);
	}
}

function handlePreSessionWorktreeAlways(): void {
	preSessionWorktreeFailure = null;
	const store = getWorktreeDefaultStore();
	const toggled = !store.globalDefault;
	void store.set(toggled);
	if (panelId) {
		panelStore.setPendingWorktreeEnabled(panelId, toggled);
	}
}

function handlePreSessionWorktreeDismiss(): void {
	preSessionWorktreeFailure = null;
	if (panelId) {
		if (panelPreparedWorktreeLaunch) {
			void discardPreparedWorktreeSessionLaunch(
				panelPreparedWorktreeLaunch.launchToken,
				true
			).match(
				() => {
					panelStore.clearPreparedWorktreeLaunch(panelId);
				},
				(error) => {
					toast.error(`Failed to discard prepared worktree: ${error.message}`);
				}
			);
		}
		panelStore.setPendingWorktreeEnabled(panelId, false);
	}
}

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

function handleQuestionSelect(event: AgentPanelQuestionSelectEvent): void {
	if (sessionId === null) {
		toast.error("Question is not ready yet.");
		return;
	}

	const semanticInteractionId = event.interactionId ?? event.entryId;
	const interaction = sessionStore.getSessionQuestionInteraction(sessionId, semanticInteractionId);
	if (interaction === null) {
		toast.error("Question is no longer available.");
		return;
	}

	const payload = interaction.payload.Question;
	const question = payload.questions[event.questionIndex];
	if (question === undefined) {
		toast.error("Question option is no longer available.");
		return;
	}

	const replyHandler =
		normalizeInteractionReplyHandler(interaction.reply_handler ?? payload.replyHandler) ??
		createLegacyInteractionReplyHandler(interaction.id, interaction.json_rpc_request_id);
	const answers = [
		{
			questionIndex: event.questionIndex,
			answers: [event.label],
		},
	];
	const answerMap: Record<string, string | string[]> = {};
	answerMap[question.question] = question.multiSelect ? [event.label] : event.label;

	void api
		.replyInteraction({
			sessionId: interaction.session_id,
			interactionId: interaction.id,
			replyHandler,
			payload: {
				kind: "question",
				answers,
				answerMap,
			},
		})
		.match(
			() => {},
			(error) => {
				toast.error(`Failed to answer question: ${error.message}`);
			}
	);
}

function handleToolFileSelect(event: AgentToolFileSelectEvent): void {
	const projectPath = effectiveProjectPath ?? sessionProjectPath;
	if (!projectPath) {
		toast.error("No project is available for this file.");
		return;
	}

	const fileReference = resolveProjectFileReference(event.filePath, projectPath);
	panelStore.openFilePanel(fileReference.filePath, projectPath, {
		ownerPanelId: effectivePanelId,
		...(fileReference.targetLine !== undefined ? { targetLine: fileReference.targetLine } : {}),
		...(fileReference.targetColumn !== undefined
			? { targetColumn: fileReference.targetColumn }
			: {}),
	});
}

function findPermissionForPlanAction(event: AgentPanelPlanActionEvent) {
	if (!sessionId) {
		return undefined;
	}
	if (event.toolCallId === undefined) {
		return undefined;
	}

	return permissionStore.getForToolCall(sessionId, event.toolCallId);
}

function replyToPlanPermission(event: AgentPanelPlanActionEvent, reply: "once" | "reject"): void {
	const permission = findPermissionForPlanAction(event);
	if (permission === undefined) {
		toast.error("Plan approval is no longer available.");
		return;
	}

	void permissionStore.reply(permission.id, reply).match(
		() => {},
		(error) => {
			toast.error(`Failed to answer plan approval: ${error.message}`);
		}
	);
}

function handlePlanBuild(event: AgentPanelPlanActionEvent): void {
	replyToPlanPermission(event, "once");
}

function handlePlanCancel(event: AgentPanelPlanActionEvent): void {
	replyToPlanPermission(event, "reject");
}

function isPlanActionAvailable(event: AgentPanelPlanActionEvent): boolean {
	return findPermissionForPlanAction(event) !== undefined;
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
	await sessionStore.sendMessage(sid, message).match(
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
	{isFullscreen}
	isDraggingEdge={panelState.isDraggingEdge}
	ondragstart={panelState.handleDragStart.bind(panelState)}
	onclick={handlePanelClick}
	onkeydown={handlePanelKeyDown}
>
	{#snippet header()}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div bind:this={headerRef}>
		<AgentPanelHeader
			{pendingProjectSelection}
			{isConnecting}
			{isRetryingConnection}
			{sessionId}
			{sessionTitle}
			{sessionAgentId}
			currentAgentId={effectivePanelAgentId}
			{availableAgents}
			{agentIconSrc}
			{agentName}
			{isFullscreen}
			{hideProjectBadge}
			{sequenceId}
			sessionStatus={panelSessionStatus}
			projectPath={sessionProjectPath}
			projectName={displayProjectName}
			{projectColor}
			{projectIconSrc}
			linkedPr={sessionMetadata?.linkedPr ?? null}
			prLinkMode={sessionMetadata?.prLinkMode ?? "automatic"}
			{debugPanelState}
			onClose={handleClose}
			{onToggleFullscreen}
			onRetryConnection={handleRetryConnection}
			onScrollToTop={scrollToTop}
			{firstMessageAttachments}
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
			onOpenRawFile={sessionId && sessionProjectPath ? handleOpenRawFile : undefined}
			onOpenInAcepe={sessionId && sessionProjectPath ? handleOpenInAcepe : undefined}
			onExportMarkdown={sessionId ? handleExportMarkdown : undefined}
			onExportJson={sessionId ? handleExportJson : undefined}
			{onAgentChange}
		/>
		</div>
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
		<div style:display={reviewMode ? "none" : undefined}>
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
					projectPath={sessionProjectPath ?? undefined}
				/>
			{/if}
		</div>
	{/snippet}

	{#snippet body()}
		<div class="flex h-full min-h-0 flex-col" style:display={reviewMode ? "none" : undefined}>
			{#if showCheckpointTimeline && sessionProjectPath && sessionId}
				<CheckpointTimeline
					{sessionId}
					projectPath={sessionProjectPath}
					{checkpoints}
					isLoading={isLoadingCheckpoints}
					onClose={handleCloseCheckpointTimeline}
					onRevertComplete={handleCheckpointRevertComplete}
				/>
			{:else}
				<div class="flex-1 min-h-0 mb-2">
					<AgentPanelContent
						bind:this={contentRef}
						bind:scrollContainer
						bind:scrollViewport={contentScrollViewport}
						bind:isAtBottom={contentIsAtBottom}
						bind:isAtTop={contentIsAtTop}
						bind:isStreaming={contentIsStreaming}
						panelId={effectivePanelId}
						{viewState}
						{sessionId}
						sceneEntries={tokenRevealSceneEntries}
						{pendingUserRevealRequestKey}
						sessionProjectPath={effectiveProjectPath ?? sessionProjectPath}
						{allProjects}
						onProjectSelected={handleProjectSelected}
						onRetryConnection={handleRetryConnection}
						onCancelConnection={handleCancelConnection}
						{agentIconSrc}
						{isFullscreen}
						{availableAgents}
						{effectiveTheme}
						{modifiedFilesState}
						isWaitingForResponse={agentPanelDisplayModel.waiting.show}
						waitingLabel={agentPanelDisplayModel.waiting.label}
						onQuestionSelect={handleQuestionSelect}
						onPlanBuild={handlePlanBuild}
						onPlanCancel={handlePlanCancel}
						onPlanViewFull={handlePlanViewFull}
						onToolFileSelect={handleToolFileSelect}
						{isPlanActionAvailable}
					/>
				</div>
				{#if viewState.kind === "conversation" && !contentIsAtTop}
					<div class="absolute top-4 left-1/2 -translate-x-1/2 z-10">
						<button
							class="h-8 w-8 flex items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-muted transition-colors"
							onclick={scrollToTop}
							aria-label={"Scroll Top"}
						>
							<ArrowUp class="h-4 w-4" />
						</button>
					</div>
				{/if}
				{#if viewState.kind === "conversation" && !contentIsAtBottom}
					<div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
						<ScrollToBottomButton visible={true} onClick={scrollToBottom} />
					</div>
				{/if}
			{/if}
		</div>
		{#if reviewMode && reviewFilesState}
			<AgentPanelReviewWorkspace
				{sessionId}
				reviewFilesState={reviewFilesState}
				selectedFileIndex={clampedReviewFileIndex}
				projectPath={sessionProjectPath}
				isActive={reviewMode}
				onClose={() => onExitReviewMode?.()}
				onFileIndexChange={(index) => onReviewFileIndexChange?.(index)}
			/>
		{/if}
	{/snippet}

	{#snippet preComposer()}
		<AgentPanelPreComposerStack
			{reviewMode}
			showConversationChrome={viewState.kind === "conversation" ||
				viewState.kind === "ready" ||
				viewState.kind === "error"}
			{worktreeDeleted}
			{centeredFullscreenContent}
			{showInlineErrorCard}
			{errorInfo}
			{inlineErrorReferenceId}
			{inlineErrorReferenceSearchable}
			onRetryConnection={handleRetryConnection}
			isRetryingConnection={isRetryingConnection}
			onDismissError={handleDismissError}
			onCopyInlineErrorReference={handleCopyInlineErrorReference}
			inlineErrorIssueDraft={inlineErrorIssueDraft}
			onIssueFromInlineError={handleIssueFromInlineError}
			{showPreSessionWorktreeCard}
			{worktreePending}
			worktreeToggleProjectPath={worktreeToggleProjectPath}
			effectiveProjectName={effectiveProjectName ?? null}
			{preSessionWorktreeFailure}
			onPreSessionWorktreeYes={handlePreSessionWorktreeYes}
			onPreSessionWorktreeNo={handlePreSessionWorktreeNo}
			onPreSessionWorktreeAlways={handlePreSessionWorktreeAlways}
			onPreSessionWorktreeDismiss={handlePreSessionWorktreeDismiss}
			onRetryWorktree={handleRetryWorktree}
			{worktreeSetupState}
			{agentInstallState}
			{sessionId}
			effectiveProjectPath={effectiveProjectPath ?? null}
			sessionProjectPath={sessionProjectPath ?? null}
			{effectivePathForGit}
			{createdPr}
			{createPrRunning}
			{prCardRenderKey}
			{prDetails}
			{prFetchError}
			linkedPr={sessionMetadata?.linkedPr ?? null}
			prLinkMode={sessionMetadata?.prLinkMode ?? "automatic"}
			{projectPrLinkReferences}
			{projectForPr}
			{streamingShipData}
			{modifiedFilesState}
			onEnterReviewMode={handleEnterReviewMode}
			onOpenReviewDialog={handleOpenReviewDialog}
			onCreatePr={createdPr ? undefined : (config) => void handleCreatePr(config)}
			{createPrLabel}
			onMergePr={(strategy) => void handleMergePr(strategy)}
			{mergePrRunning}
			{availableAgents}
			effectivePanelAgentId={effectivePanelAgentId}
			{sessionCurrentModelId}
			{effectiveTheme}
			{showTodoHeader}
			{todoState}
			getTodoMarkdown={getTodoMarkdown}
			queueStripMessages={queueStripDisplayMessages}
			{queueIsPaused}
			onQueueCancel={handleQueueStripCancel}
			onQueueRemoveAttachment={handleQueueStripRemoveAttachment}
			onQueueClear={handleQueueStripClear}
			onQueueResume={queueIsPaused && sessionId ? () => messageQueueStore.resume(sessionId) : undefined}
			onQueueSendNow={handleQueueStripSendNow}
		/>
	{/snippet}

	{#snippet composer()}
		<div style:display={reviewMode ? "none" : undefined}>
			{#if viewState.kind === "conversation" || viewState.kind === "ready" || viewState.kind === "error"}
				<SharedAgentPanelComposerFrame
					centered={centeredFullscreenContent}
					widthClass="max-w-[60%]"
				>
					{#key inputRenderKey}
						{#snippet preSessionAgentPicker()}
							<div class="flex h-7 shrink-0 items-center">
								<AgentSelector
									{availableAgents}
									currentAgentId={effectivePanelAgentId}
									{onAgentChange}
								/>
								<div class="h-full w-px shrink-0 bg-border/50"></div>
								<ProjectSelector
									selectedProject={preSessionSelectedProject}
									recentProjects={allProjects}
									onProjectChange={handleComposerProjectSelected}
								/>
							</div>
						{/snippet}
						<AgentInput
							bind:this={agentInputRef}
							sessionId={sessionId ?? undefined}
							sessionIsConnected={sessionIsConnected}
							{sessionIsStreaming}
							{sessionCanSubmit}
							{sessionShowStop}
							disableSend={disableSendForFailedFirstSend}
							{panelId}
							voiceSessionId={panelId}
							projectPath={worktreeToggleProjectPath ?? undefined}
							projectName={effectiveProjectName ?? undefined}
							worktreePath={effectiveActiveWorktreePath ?? undefined}
							{worktreePending}
							preparedWorktreeLaunch={panelPreparedWorktreeLaunch}
							onWorktreeCreating={() => {
								preSessionWorktreeFailure = null;
								worktreeSetupState = createWorktreeCreationState({
									projectPath:
										worktreeToggleProjectPath || sessionProjectPath || project?.path || "",
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
							agentProjectPicker={hasSession ? undefined : preSessionAgentPicker}
							pendingProjectSelection={pendingProjectSelection && !isWaitingForSession}
							onSessionCreated={handleSessionCreated}
							onWillSend={prepareForNextUserReveal}
							onToolbarWidthChange={(w) => {
								toolbarMinWidth = w;
							}}
						>
							{#snippet checkpointButton()}
								{#if sessionProjectPath && checkpoints.length > 0}
									<EmbeddedIconButton
										active={showCheckpointTimeline}
										title={"View checkpoints"}
										ariaLabel={"View checkpoints"}
										onclick={handleToggleCheckpointTimeline}
									>
										<Clock class="h-3.5 w-3.5" weight="fill" />
									</EmbeddedIconButton>
								{/if}
							{/snippet}
						</AgentInput>
					{/key}
				</SharedAgentPanelComposerFrame>
			{/if}
		</div>
	{/snippet}

	{#snippet footer()}
		<div style:display={reviewMode ? "none" : undefined}>
			{#if
				(viewState.kind === "conversation" || viewState.kind === "ready" || viewState.kind === "error") &&
				worktreeToggleProjectPath &&
				panelId
			}
				<SharedFooter
					showTrailingBorder={!isFullscreen}
					browserActive={showBrowserSidebar}
					browserTitle="Toggle browser"
					browserAriaLabel="Toggle browser"
					onToggleBrowser={() => {
						if (panelId) {
							panelStore.toggleBrowserSidebar(panelId);
						}
					}}
					terminalActive={isTerminalDrawerOpen}
					terminalDisabled={effectivePathForGit === null}
					terminalTitle={effectivePathForGit !== null
						? "Toggle terminal"
						: "No project selected"}
					terminalAriaLabel={"Toggle terminal"}
					onToggleTerminal={() => {
						if (panelId && effectivePathForGit) {
							panelStore.toggleEmbeddedTerminalDrawer(panelId, effectivePathForGit);
						}
					}}
				>
					{#snippet left()}
						<div class="flex items-center divide-x divide-border/50">
							{#if footerWorktreeStatus}
								<WorktreeFooterButton
									worktreePath={effectiveActiveWorktreePath}
									label={footerWorktreeStatus.primaryLabel}
									mode={footerWorktreeStatus.mode}
								/>
							{/if}
						</div>
					{/snippet}
				</SharedFooter>
			{/if}
		</div>
	{/snippet}

	{#snippet bottomDrawer()}
		<div style:display={reviewMode ? "none" : undefined}>
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
						projectPath={sessionProjectPath ?? undefined}
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
				onPointerDown={(e) => panelState.handlePointerDownEdge(e, panelId)}
				onPointerMove={(e) => panelState.handlePointerMoveEdge(e, panelId, onResizePanel)}
				onPointerUp={() => panelState.handlePointerUpEdge()}
			/>
		{/if}
	{/snippet}
</AgentPanelShell>

<WorkspaceDialogFrame
	open={reviewDialogOpen}
	title="Review changes"
	closeLabel="Close review"
	contentOverflow="hidden"
	onOpenChange={handleReviewDialogOpenChange}
>
	{#snippet topRight()}
		{@const controls = reviewDialogControls}
		{#if controls && controls.fileTotal > 1}
			<div
				class="flex h-5 shrink-0 items-center rounded border border-border bg-muted/60 text-[11px]"
			>
				<button
					type="button"
					class="inline-flex h-full items-center justify-center px-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
					disabled={!controls.hasPrevPendingFile}
					onclick={controls.onPrevFile}
					aria-label="Previous file"
					title="Previous file"
				>
					<CaretLeft size={10} weight="bold" />
				</button>
				<span
					class="inline-flex h-full items-center justify-center px-1 font-medium tabular-nums text-foreground/80"
					aria-label="File {controls.fileCurrent} of {controls.fileTotal}"
				>
					{controls.fileCurrent}/{controls.fileTotal}
				</span>
				<button
					type="button"
					class="inline-flex h-full items-center justify-center px-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
					disabled={!controls.hasNextPendingFile}
					onclick={controls.onNextFile}
					aria-label="Next file"
					title="Next file"
				>
					<CaretRight size={10} weight="bold" />
				</button>
			</div>
		{/if}

		{#if controls}
			<div
				class="flex h-5 shrink-0 items-center rounded border border-border bg-muted/60 text-[11px]"
			>
				<button
					type="button"
					class="inline-flex h-full items-center gap-1 px-1.5 font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
					disabled={!controls.hasPendingHunks}
					onclick={controls.onRejectFile}
					title="Reject file"
				>
					<XCircle size={11} weight="fill" style="color: {Colors.red};" />
					Undo
				</button>
				<div class="h-3 w-px bg-border/70"></div>
				<button
					type="button"
					class="inline-flex h-full items-center gap-1 px-1.5 font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
					disabled={!controls.hasPendingHunks}
					onclick={controls.onAcceptFile}
					title="Keep file"
				>
					<CheckCircle size={11} weight="fill" class="text-success" />
					Keep
				</button>
			</div>
		{/if}

		{#if !createdPr}
			<button
				type="button"
				class="group/open-pr flex h-5 shrink-0 items-center justify-between gap-1 rounded border border-border bg-muted/60 px-1.5 text-[11px] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
				disabled={createPrRunning || !effectivePathForGit}
				onclick={() => void handleCreatePr()}
			>
				<span class="flex min-w-0 items-center gap-1">
					<GitPullRequest
						size={11}
						weight="bold"
						class="shrink-0 text-muted-foreground transition-colors group-hover/open-pr:text-success"
					/>
					<span class="font-medium text-foreground leading-none">
						{createPrLabel ?? "Open PR"}
					</span>
				</span>
				<DiffPill
					insertions={reviewDialogDiffStats.insertions}
					deletions={reviewDialogDiffStats.deletions}
					variant="plain"
				/>
			</button>
		{:else}
			<div
				class="flex h-5 shrink-0 items-center justify-between gap-1 rounded border border-border bg-muted/60 px-1.5 text-[11px]"
			>
				<span class="flex min-w-0 items-center gap-1">
					<GitPullRequest size={11} weight="bold" class="shrink-0 text-success" />
					<span class="font-medium text-foreground leading-none tabular-nums">#{createdPr}</span>
				</span>
				<DiffPill
					insertions={reviewDialogDiffStats.insertions}
					deletions={reviewDialogDiffStats.deletions}
					variant="plain"
				/>
			</div>
		{/if}
	{/snippet}

	{#if reviewDialogFilesState}
		<AgentPanelReviewWorkspace
			{sessionId}
			reviewFilesState={reviewDialogFilesState}
			selectedFileIndex={clampedReviewDialogFileIndex}
			projectPath={sessionProjectPath}
			isActive={reviewDialogOpen}
			showHeader={false}
			showCloseButton={false}
			compact={true}
			diffDensity="compact"
			hideBottomWidget={true}
			onControlsChange={handleReviewDialogControlsChange}
			onClose={() => handleReviewDialogOpenChange(false)}
			onFileIndexChange={(index) => (reviewDialogFileIndex = index)}
		/>
	{/if}
</WorkspaceDialogFrame>

{#if inlinePlanDialogPlan}
	<PlanDialog
		plan={inlinePlanDialogPlan}
		open={inlinePlanDialogPlan !== null}
		onOpenChange={handleInlinePlanDialogOpenChange}
		projectPath={sessionProjectPath ?? undefined}
	/>
{/if}

<AgentPanelWorktreeCloseConfirmPopover
	bind:open={worktreeCloseConfirming}
	headerAnchor={headerRef}
	title={worktreeDirtyCheckPending
		? "Checking repository..."
		: worktreeHasDirtyChanges
			? `Has uncommitted changes — remove "${_activeWorktreeName ?? "worktree"}"?`
			: `Remove worktree "${_activeWorktreeName ?? "worktree"}"?`}
	description={"The worktree branch and directory will be permanently deleted."}
	cancelLabel={"Cancel"}
	confirmLabel={"Confirm"}
	confirmDisabled={worktreeDirtyCheckPending}
	onCancel={handleWorktreeCloseCancel}
	onConfirmRemoveAndClose={handleWorktreeRemoveAndClose}
/>
