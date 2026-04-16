<script lang="ts">
import { AgentPanelShell } from "@acepe/ui/agent-panel";
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { okAsync, ResultAsync } from "neverthrow";
import { Clock } from "phosphor-svelte";
import { Trash } from "phosphor-svelte";
import { Tree } from "phosphor-svelte";
import { tick } from "svelte";
import { toast } from "svelte-sonner";
import * as Popover from "$lib/components/ui/popover/index.js";
import { createLocalReferenceDetails } from "$lib/errors/error-reference.js";
import { resolveIssueActionLabel } from "$lib/errors/issue-report.js";
import * as m from "$lib/messages.js";
import { getErrorCauseDetails } from "../../../errors/error-cause-details.js";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import { openFileInEditor } from "$lib/utils/tauri-client/opener.js";
import { revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
import AgentAttachedFilePane from "../../../../components/main-app-view/components/content/agent-attached-file-pane.svelte";
import type { Project } from "../../../logic/project-manager.svelte";
import { checkpointStore } from "../../../store/checkpoint-store.svelte.js";
import { getAgentStore } from "../../../store/index.js";
import { getConnectionStore } from "../../../store/connection-store.svelte.js";
import { getPanelStore } from "../../../store/panel-store.svelte.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import { mergeStrategyStore } from "../../../store/merge-strategy-store.svelte.js";
import { formatSessionTitleForDisplay } from "../../../store/session-title-policy.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { PanelConnectionEvent } from "../../../types/panel-connection-state.js";
import { PanelConnectionState } from "../../../types/panel-connection-state.js";
import type { WorktreeSetupEvent } from "../../../types/worktree-setup.js";
import type { WorktreeInfo } from "../../../types/worktree-info.js";
import { computeStatsFromCheckpoints } from "../../../utils/checkpoint-diff-utils.js";
import { getProjectColor, TAG_COLORS } from "../../../utils/colors";
import { createLogger } from "../../../utils/logger.js";
import { sessionEntriesToMarkdown } from "../../../utils/session-to-markdown.js";
import AgentInput from "../../agent-input/agent-input-ui.svelte";
import { shouldDisableSendForFailedFirstSend } from "../../agent-input/logic/first-send-recovery.js";
import type { Attachment } from "../../agent-input/types/attachment.js";
import { CheckpointTimeline } from "../../checkpoint/index.js";
import { aggregateFileEdits } from "../../modified-files/logic/aggregate-file-edits.js";
import ModifiedFilesHeader, {
	type PrGenerationConfig,
} from "../../modified-files/modified-files-header.svelte";
import * as agentModelPrefs from "../../../store/agent-model-preferences-store.svelte.js";
import PrStatusCard from "../../pr-status-card/pr-status-card.svelte";
import {
	AgentPanelComposerFrame as SharedAgentPanelComposerFrame,
	AgentPanelWorktreeStatusDisplay as SharedWorktreeStatusDisplay,
	AgentPanelPlanHeader as SharedPlanHeader,
} from "@acepe/ui/agent-panel";
import PlanDialog from "../../plan-dialog.svelte";
import { PlanSidebar } from "../../plan-sidebar/index.js";
import { AgentPanelQueueCardStrip as SharedQueueCardStrip } from "@acepe/ui/agent-panel";
import { getMessageQueueStore } from "../../../store/message-queue/message-queue-store.svelte.js";
import { AgentPanelTodoHeader as SharedTodoHeader } from "@acepe/ui/agent-panel";
import type { ThreadWithEntries } from "../../../logic/todo-state.svelte.js";
import { getTodoStateManager } from "../../../logic/todo-state-manager.svelte.js";
import CopyButton from "../../messages/copy-button.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";
import { usePlanLoader } from "../hooks";
import {
	createWorktreeSetupMatchContext,
	createPendingWorktreeCloseConfirmationState,
	createResolvedWorktreeCloseConfirmationState,
	createWorktreeCreationState,
	copySessionToClipboard,
	copyTextToClipboard,
	derivePanelErrorInfo,
	mapSessionStatusToUI,
	matchesWorktreeSetupContext,
	removeWorktreeAndMarkSessionWorktreeDeleted,
	reduceWorktreeSetupEvent,
	resolveEffectiveProjectPath,
	resolveVisibleSessionEntries,
	shouldConfirmWorktreeClose,
} from "../logic";
import { resolveAgentPanelWorktreePending } from "../logic/worktree-pending.js";
import { getWorktreeDefaultStore } from "../../worktree/worktree-default-store.svelte.js";
import { getAgentIcon } from "../../../constants/thread-list-constants.js";
import { derivePanelViewState } from "../../../logic/panel-visibility.js";
import { getOpenInFinderTarget } from "../logic/open-in-finder-target";
import { createPanelBranchLookupController } from "../logic/panel-branch-lookup.js";
import type { WorktreeSetupState } from "../logic/worktree-setup-events.js";
import { shouldAutoScrollOnPanelActivation } from "../logic/should-auto-scroll-on-panel-activation.js";
import { resolveWorktreeToggleProjectPath } from "../logic/worktree-toggle-project-path.js";
import { AgentPanelState } from "../state/agent-panel-state.svelte";
import type { AgentPanelProps } from "../types";
import { BrowserPanel as BrowserPanelComponent } from "../../browser-panel/index.js";
import { AgentPanelFooter as SharedFooter } from "@acepe/ui/agent-panel";
import AgentPanelContent from "./agent-panel-content.svelte";
import AgentPanelHeader from "./agent-panel-header.svelte";
import PreSessionWorktreeCard from "./pre-session-worktree-card.svelte";
import AgentPanelResizeEdge from "./agent-panel-resize-edge.svelte";
import AgentPanelReviewContent from "./agent-panel-review-content.svelte";
import AgentPanelTerminalDrawer from "./agent-panel-terminal-drawer.svelte";
import ScrollToBottomButton from "./scroll-to-bottom-button.svelte";
import AgentInstallCard from "./agent-install-card.svelte";
import {
	resolveAgentContentColumnStyle,
	resolveAgentPanelWidthStyle,
	shouldUseCenteredFullscreenContent,
} from "./agent-panel-layout.js";
import WorktreeSetupCard from "./worktree-setup-card.svelte";
import AgentErrorCard from "./agent-error-card.svelte";
import { buildAgentErrorIssueDraft } from "../logic/issue-report-draft.js";
import type { FileReviewStatus } from "../../review-panel/review-session-state.js";
import type { PanelConnectionErrorDetails } from "../../../types/panel-connection-state.js";

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
	onOpenFullscreenReview,
	attachedFilePanels = [],
	activeAttachedFilePanelId = null,
	onSelectAttachedFilePanel,
	onCloseAttachedFilePanel,
	onResizeAttachedFilePanel,
	onCreateIssueReport,
}: AgentPanelProps = $props();

// ✅ State managers (must be before derived values that use them)
const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const connectionStore = getConnectionStore();
const agentStore = getAgentStore();
const messageQueueStore = getMessageQueueStore();
const logger = createLogger({ id: "agent-panel-render-trace", name: "AgentPanelRenderTrace" });
let lastPanelTraceSignature = $state<string | null>(null);

// ============================================================
// GRANULAR SESSION DATA - Fine-grained reactivity
// Each accessor only triggers re-renders when ITS data changes
// ============================================================

// Identity: id, projectPath, agentId, worktreePath (immutable - never changes)
const sessionIdentity = $derived(sessionId ? sessionStore.getSessionIdentity(sessionId) : null);

// Metadata: title, createdAt, updatedAt (rarely changes)
const sessionMetadata = $derived(sessionId ? sessionStore.getSessionMetadata(sessionId) : null);

// Entries: conversation content (changes frequently during streaming)
// Merges any optimistic pending entry (shown before session creation) with real entries.
// Fast path: when no pending entry (99% of renders), returns the exact array reference — zero allocation.
// Note: getHotState(panelId) subscribes to ALL hot state changes for this panel (messageDraft,
// reviewMode, etc.), not just pendingUserEntry. This causes extra recomputations during typing,
// but the fast path returns the same array reference so Svelte skips DOM updates. Acceptable trade-off.
const panelHotState = $derived(panelId ? panelStore.getHotState(panelId) : null);
const panelSnapshot = $derived(panelId ? panelStore.getTopLevelPanel(panelId) : null);
const panelPendingWorktreeEnabled = $derived(
	panelSnapshot?.kind === "agent" ? panelSnapshot.pendingWorktreeEnabled ?? null : null
);
const panelPreparedWorktreeLaunch = $derived(
	panelSnapshot?.kind === "agent" ? panelSnapshot.preparedWorktreeLaunch ?? null : null
);
const sessionEntries = $derived.by(() => {
	const pending = panelHotState?.pendingUserEntry ?? null;
	const real = sessionId ? sessionStore.getEntries(sessionId) : [];
	if (!pending) return real;
	if (real.length > 0 && real[0]?.type === "user") return real;
	return [pending, ...real];
});

// Hot state: status, isStreaming (changes during activity)
const sessionHotState = $derived(sessionId ? sessionStore.getHotState(sessionId) : null);

// Computed from granular data
const FILE_MODIFYING_KINDS = new Set(["edit", "delete", "move"]);
const hasEdits = $derived(
	sessionEntries.some(
		(e) => e.type === "tool_call" && e.message.kind && FILE_MODIFYING_KINDS.has(e.message.kind)
	)
);
const hasMessages = $derived(sessionEntries.length > 0);
const sessionProjectPath = $derived(sessionIdentity?.projectPath ?? null);
const sessionAgentId = $derived(sessionIdentity?.agentId ?? null);
const sessionWorktreePath = $derived(sessionIdentity?.worktreePath ?? null);
const sessionTitle = $derived(sessionMetadata?.title ?? null);

// Current model from session hot state (for PR popover default)
const sessionCurrentModelId = $derived(
	sessionId ? (sessionStore.getHotState(sessionId)?.currentModel?.id ?? null) : null
);

// ✅ State manager for local UI state only (drag, dialog)
const panelState = new AgentPanelState();
const panelBranchLookup = createPanelBranchLookupController();

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

// Scroll viewport reference for scroll-to-bottom button (bindable from child)
let contentScrollViewport: HTMLElement | null = $state(null);
let contentIsAtBottom = $state(true);
let contentIsAtTop = $state(true);
let contentIsStreaming = $state(false);
let panelConnectionState = $state<PanelConnectionState | null>(null);
let panelConnectionError = $state<PanelConnectionErrorDetails | null>(null);
let errorDismissed = $state(false);
let fallbackInlineErrorReferenceId = $state<string | null>(null);
let fallbackInlineErrorFingerprint = $state<string | null>(null);

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
	logger.info("prepareForNextUserReveal: panel", {
		panelId: effectivePanelId,
		sessionId,
		entryCount: sessionEntries.length,
		latestEntryId: sessionEntries.at(-1)?.id ?? null,
		latestEntryType: sessionEntries.at(-1)?.type ?? null,
	});
	contentRef?.prepareForNextUserReveal({ force: true });
	return effectivePanelId;
}

function scrollToBottomOnTabSwitch() {
	// Returning to the panel resumes live follow for that thread.
	contentRef?.scrollToBottom({ force: true });
}

// Effective panel ID (use prop or generate one)
const effectivePanelId = $derived(panelId ?? "default-panel");

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

// Canonical runtime state from session machine.
const runtimeState = $derived(sessionId ? sessionStore.getSessionRuntimeState(sessionId) : null);
const entriesCount = $derived(sessionEntries.length);
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

// ✅ Derived values from granular session data
const agentName = $derived(sessionAgentId ?? selectedAgentId);
const sessionStatus = $derived.by(() => {
	if (!sessionId && panelId && panelStore.getHotState(panelId).pendingUserEntry)
		return "connecting";
	const connectionPhase = runtimeState?.connectionPhase;
	const activityPhase = runtimeState?.activityPhase;
	if (!connectionPhase) return null;
	if (connectionPhase === "failed") return "error";
	if (connectionPhase === "connecting") return "connecting";
	if (connectionPhase === "disconnected") return "idle";
	if (activityPhase === "running") return "streaming";
	return "ready";
});
const mappedSessionStatus = $derived(mapSessionStatusToUI(sessionStatus));
const sessionIsStreaming = $derived(runtimeState?.activityPhase === "running");
const sessionCanSubmit = $derived(runtimeState?.canSubmit ?? false);
const sessionShowStop = $derived(runtimeState?.showStop ?? false);
const sessionConnectionError = $derived(sessionHotState?.connectionError ?? null);
const activeTurnError = $derived.by(() => {
	const activeTurnFailure = sessionHotState?.activeTurnFailure;
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
		sessionTurnState: sessionHotState?.turnState,
		activeTurnError,
	})
);
const inlineErrorReferenceId = $derived(errorInfo.referenceId ?? fallbackInlineErrorReferenceId);
const inlineErrorReferenceSearchable = $derived(
	errorInfo.referenceId !== null ? errorInfo.referenceSearchable : false
);

// Reset dismiss state when error content changes so a new error is always visible
$effect(() => {
	const _details = errorInfo.details;
	if (!errorInfo.showError) {
		errorDismissed = false;
	}
});

$effect(() => {
	const details = errorInfo.details;
	if (!errorInfo.showError || details === null) {
		fallbackInlineErrorReferenceId = null;
		fallbackInlineErrorFingerprint = null;
		return;
	}

	if (errorInfo.referenceId !== null) {
		fallbackInlineErrorReferenceId = null;
		fallbackInlineErrorFingerprint = null;
		return;
	}

	const nextFingerprint = `${errorInfo.title}|${details}`;
	if (
		fallbackInlineErrorFingerprint === nextFingerprint &&
		fallbackInlineErrorReferenceId !== null
	) {
		return;
	}

	fallbackInlineErrorFingerprint = nextFingerprint;
	fallbackInlineErrorReferenceId = createLocalReferenceDetails().referenceId;
});

const showInlineErrorCard = $derived(errorInfo.showError && !errorDismissed);
const visibleSessionEntries = $derived.by(() =>
	resolveVisibleSessionEntries({
		sessionEntries,
		activeTurnError,
	})
);

// Panel view state: single discriminated union from all inputs
const viewStateInput = $derived({
	runtimeState,
	entriesCount,
	hasSession,
	showProjectSelection,
	hasEffectiveProjectPath: !!effectiveProjectPath,
	hasSelectedAgentId: !!selectedAgentId,
	hasAvailableAgents: availableAgents.length > 0,
	errorInfo,
});
const viewState = $derived(derivePanelViewState(viewStateInput));
const panelViewKind = $derived(viewState.kind);
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
const showPreSessionWorktreeCard = $derived(
	sessionId === null && !pendingProjectSelection && worktreeToggleProjectPath !== null &&
	pendingWorktreeSetup === null && !worktreeSetupState?.isVisible
);

$effect(() => {
	if (!import.meta.env.DEV) return;
	logger.info("[first-send-trace] panel render gate", {
		panelId: effectivePanelId,
		sessionId: sessionId ?? null,
		viewState: viewState.kind,
		pendingUserEntry: panelId ? panelStore.getHotState(panelId).pendingUserEntry !== null : false,
		entriesCount: sessionEntries.length,
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
		entryCount: sessionEntries.length,
		latestEntryId: sessionEntries.at(-1)?.id ?? null,
		latestEntryType: sessionEntries.at(-1)?.type ?? null,
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
	const unlistenPromise = listen<WorktreeSetupEvent>("git:worktree-setup", (event) => {
		if (
			!matchesWorktreeSetupContext(event.payload, {
				projectPaths,
				worktreePaths,
			})
		) {
			return;
		}

		if (panelId) {
			panelStore.clearPendingWorktreeSetup(panelId);
		}
		worktreeSetupState = reduceWorktreeSetupEvent(worktreeSetupState, event.payload);
	});

	unlistenPromise
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
	if (!sessionTitle && !displayProjectName) return null;
	return formatSessionTitleForDisplay(sessionTitle, displayProjectName, "Project");
});
const sessionDiffStats = $derived.by(() => {
	if (!sessionId) return { insertions: 0, deletions: 0 };
	const checkpoints = checkpointStore.getCheckpoints(sessionId);
	const stats = computeStatsFromCheckpoints(checkpoints);
	return stats ?? { insertions: 0, deletions: 0 };
});
const sessionCreatedAt = $derived(sessionMetadata?.createdAt ?? null);
const sessionUpdatedAt = $derived(sessionMetadata?.updatedAt ?? null);

const agentIconSrc = $derived(getAgentIcon(agentName, effectiveTheme));
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

const hasPlan = $derived(planState.plan !== null);
const ATTACHED_COLUMN_WIDTH = 450;
const PLAN_SIDEBAR_COLUMN_WIDTH = 450;
const REVIEW_COLUMN_WIDTH = 450;
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
let headerRef: HTMLElement | undefined = $state();
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
	if (!selectedAgentId) return null;
	const progress = agentStore.installing[selectedAgentId];
	if (!progress) return null;
	const agent = availableAgents.find((a) => a.id === selectedAgentId);
	return {
		agentId: selectedAgentId,
		agentName: agent?.name ?? selectedAgentId,
		stage: progress.stage,
		progress: progress.progress,
	};
});

// Derived from session store — populated from DB on startup, updated in-session after PR creation
// Also auto-populated when Claude creates a PR autonomously (handleStreamComplete extracts PR# from messages)
const createdPr = $derived(sessionMetadata?.prNumber ?? null);

function hasStreamingPreviewContent(
	data: import("../../ship-card/ship-card-parser.js").ShipCardData | null
): boolean {
	return Boolean(data && (data.prTitle !== null || data.prDescription !== null));
}

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
const hasAttachedPane = $derived(Boolean(panelId) && attachedFilePanels.length > 0);
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

// Clamp reviewFileIndex to valid bounds so a stale index never leaves the review pane empty.
const clampedReviewFileIndex = $derived.by(() => {
	const fileCount = reviewFilesState?.fileCount ?? 0;
	if (fileCount === 0) return 0;
	return Math.min(reviewFileIndex, fileCount - 1);
});

// Add embedded pane widths (plan sidebar, review) when expanded
const effectiveWidth = $derived.by(() => {
	let w = baseWidth;
	if (showPlanSidebar && hasPlan) w += PLAN_SIDEBAR_COLUMN_WIDTH;
	if (reviewMode && reviewFilesState) w += REVIEW_COLUMN_WIDTH;
	if (showBrowserSidebar) w += BROWSER_SIDEBAR_COLUMN_WIDTH;
	return w;
});

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
		sessionStatus: mappedSessionStatus,
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

// Compute aggregateFileEdits off the main thread to avoid blocking the reactive cascade.
// Uses $effect + setTimeout(0) so it runs after the current reactive cascade settles.
// (requestIdleCallback is unavailable in Tauri's WebKit webview on macOS)
let modifiedFilesState = $state<ModifiedFilesState | null>(null);
$effect(() => {
	if (viewState.kind !== "conversation" || sessionEntries.length === 0) {
		modifiedFilesState = null;
		return;
	}
	// Capture reactive dependencies synchronously, then defer the heavy work
	const entries = sessionEntries;
	const id = setTimeout(() => {
		const state = aggregateFileEdits(entries);
		modifiedFilesState = state.fileCount > 0 ? state : null;
	});
	return () => clearTimeout(id);
});

// Track panelId changes for tab switching detection
let lastPanelId = $state<string | undefined>(undefined);

// Restore review mode when session loads (deferred from workspace restore)
$effect(() => {
	if (!panelId || !sessionId || sessionEntries.length === 0 || reviewMode) return;

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

	void tauriClient.git.currentBranch(decision.path).match(
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
	void tauriClient.git.worktreeList(projectPath).match(
		(worktrees) => {
			if (disposed) return;
			const found = worktrees.some((wt) => wt.directory === worktreePath);
			if (!found) {
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
		const hasDirtyChanges = await tauriClient.git.hasUncommittedChanges(worktreePath).match(
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
			removeWorktree: (path, shouldForce) => tauriClient.git.worktreeRemove(path, shouldForce),
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

function handlePreparedWorktreeLaunch(launch: import("$lib/acp/types/worktree-info.js").PreparedWorktreeLaunch): void {
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
		void tauriClient.git
			.discardPreparedWorktreeSessionLaunch(panelPreparedWorktreeLaunch.launchToken, true)
			.match(
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

	void tauriClient.history
		.setSessionWorktreePath(
			sessionId,
			info.directory,
			sessionProjectPath ? sessionProjectPath : undefined,
			sessionAgentId ? sessionAgentId : undefined
		)
		.mapErr((error) => {
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
	createPrRunning = true;
	createPrLabel = m.agent_panel_pr_staging();

	// Stage agent-modified files before commit+push+PR
	if (modifiedFilesState) {
		const prefix = path.endsWith("/") ? path : `${path}/`;
		const filePaths = modifiedFilesState.files.map((f) =>
			f.filePath.startsWith(prefix) ? f.filePath.slice(prefix.length) : f.filePath
		);
		logger.info("handleCreatePr: staging modified files", { count: filePaths.length, filePaths });
		const stageResult = await tauriClient.git.stageFiles(path, filePaths);
		if (stageResult.isErr()) {
			createPrRunning = false;
			createPrLabel = null;
			const details = getErrorCauseDetails(stageResult._unsafeUnwrapErr());
			logger.error("handleCreatePr: staging failed", {
				rootCause: details.rootCause,
				formatted: details.formatted,
			});
			toast.error(details.rootCause ?? stageResult._unsafeUnwrapErr().message);
			return;
		}
	}

	// Generate commit message + PR content via AI (falls back to default if generation fails)
	createPrLabel = m.git_generating();
	streamingShipData = null;
	let commitMsg = m.agent_panel_default_commit_message();
	let prTitle: string | undefined;
	let prBody: string | undefined;

	const shipCtxResult = await tauriClient.git.collectShipContext(
		path,
		config?.customPrompt ? config.customPrompt : undefined
	);
	if (shipCtxResult.isOk() && shipCtxResult.value) {
		const ctx = shipCtxResult.value;
		logger.info("handleCreatePr: generating commit/PR content via AI", { branch: ctx.branch });
		const prompt = ctx.prompt;

		// Use the streaming text generation service — updates the PR card live
		const { generateShipContentStreaming } = await import(
			"../../ship-card/ship-card-generation.js"
		);
		const genResult = await generateShipContentStreaming(
			prompt,
			path,
			(data) => {
				const hadPreviewContent = hasStreamingPreviewContent(streamingShipData);
				const hasPreviewContent = hasStreamingPreviewContent(data);
				if (!hadPreviewContent && hasPreviewContent) {
					prCardRenderKey += 1;
				}
				streamingShipData = data;
			},
			config?.agentId
				? config.agentId
				: sessionAgentId
					? sessionAgentId
					: selectedAgentId
						? selectedAgentId
						: undefined,
			config?.modelId ? config.modelId : undefined
		);
		if (genResult.isOk()) {
			const gen = genResult.value;
			if (gen.commitMessage) commitMsg = gen.commitMessage as typeof commitMsg;
			if (gen.prTitle) prTitle = gen.prTitle;
			if (gen.prDescription) prBody = gen.prDescription;
			logger.info("handleCreatePr: AI generation complete", { prTitle, hasBody: !!prBody });
		} else {
			logger.warn("handleCreatePr: AI generation failed, using defaults", {
				error: genResult.error.message,
			});
			streamingShipData = null;
		}
	}

	createPrLabel = m.agent_panel_pr_pushing();
	logger.info("handleCreatePr: calling runStackedAction", {
		path,
		action: "commit_push_pr",
		commitMsg,
		prTitle,
	});
	const result = await tauriClient.git.runStackedAction(
		path,
		"commit_push_pr",
		commitMsg,
		prTitle,
		prBody
	);
	await result.match(
		(ok) => {
			createPrRunning = false;
			createPrLabel = null;
			streamingShipData = null;
			logger.info("handleCreatePr: success", {
				action: ok.action,
				commitStatus: ok.commit.status,
				pushStatus: ok.push.status,
				prStatus: ok.pr.status,
				prUrl: ok.pr.url,
			});
			switch (ok.pr.status) {
				case "created":
					toast.success(`Created PR #${ok.pr.number ?? ""}`);
					break;
				case "opened_existing":
					toast.success(`Opened PR #${ok.pr.number ?? ""}`);
					break;
				case "skipped_not_requested":
					toast.success("Pushed to branch");
					break;
				default: {
					const _: never = ok.pr.status;
					toast.success("Pushed to branch");
				}
			}
			if (ok.pr.status === "created" || ok.pr.status === "opened_existing") {
				if (ok.pr.number != null && sessionId) {
					sessionStore.updateSession(sessionId, { prNumber: ok.pr.number });
					void tauriClient.history.setSessionPrNumber(sessionId, ok.pr.number);
				}
				if (ok.pr.url) void openUrl(ok.pr.url).catch(() => {});
			}
		},
		(err) => {
			createPrRunning = false;
			createPrLabel = null;
			streamingShipData = null;
			const details = getErrorCauseDetails(err);
			logger.error("handleCreatePr: failed", {
				message: err.message,
				rootCause: details.rootCause,
				chain: details.chain,
				formatted: details.formatted,
			});
			toast.error(details.rootCause ?? err.message);
		}
	);
}

async function handleMergePr(strategy: MergeStrategy) {
	const path = effectivePathForGit;
	const prNum = createdPr;
	if (!path || prNum == null || !sessionId) return;
	mergePrRunning = true;
	try {
		await tauriClient.git.mergePr(path, prNum, strategy).match(
			() => {
				toast.success(m.agent_panel_pr_merged());
				if (sessionId) {
					sessionStore.updateSession(sessionId, { prState: "MERGED" });
				}
				// Refresh PR details so the card reflects the merged state
				fetchPrDetails({
					sessionId,
					projectPath: path,
					prNumber: prNum,
				});
			},
			(err) => {
				const details = getErrorCauseDetails(err);
				toast.error(details.rootCause ?? err.message);
			}
		);
	} finally {
		mergePrRunning = false;
	}
}

async function handleCopyContent() {
	if (!sessionId) {
		toast.error(m.thread_copy_content_error_no_thread());
		return;
	}

	// Assemble cold data + entries for clipboard copy
	const cold = sessionStore.getSessionCold(sessionId);
	if (!cold) {
		toast.error(m.thread_copy_content_error_no_thread());
		return;
	}
	const entries = sessionStore.getEntries(sessionId);

	await copySessionToClipboard({ ...cold, entries, entryCount: entries.length }).match(
		() => toast.success(m.thread_copy_content_success()),
		() => toast.error(m.thread_copy_content_error())
	);
}

async function handleOpenInFinder() {
	const target = getOpenInFinderTarget({
		sessionId,
		projectPath: sessionProjectPath,
		agentId: sessionAgentId,
		sourcePath: sessionMetadata?.sourcePath ?? null,
	});

	if (!target) {
		toast.error(m.thread_open_in_finder_error_no_thread());
		return;
	}

	if (target.kind === "reveal") {
		await revealInFinder(target.path).mapErr(() => toast.error(m.thread_open_in_finder_error()));
		return;
	}

	await tauriClient.shell
		.openInFinder(target.sessionId, target.projectPath)
		.mapErr(() => toast.error(m.thread_open_in_finder_error()));
}

async function handleExportRawStreaming() {
	if (!sessionId) {
		toast.error(m.thread_export_raw_error_no_thread());
		return;
	}

	await tauriClient.shell.openStreamingLog(sessionId).match(
		() => undefined,
		(error) => toast.error(m.thread_export_raw_error({ error: error.message }))
	);
}

async function handleCopyStreamingLogPath() {
	if (!sessionId) {
		logger.warn("handleCopyStreamingLogPath: no session id");
		toast.error(m.thread_export_raw_error_no_thread());
		return;
	}

	logger.info("handleCopyStreamingLogPath: requesting streaming log path", { sessionId });

	await tauriClient.shell
		.getStreamingLogPath(sessionId)
		.andThen((path) => {
			logger.info("handleCopyStreamingLogPath: received streaming log path", {
				sessionId,
				path,
			});

			return copyTextToClipboard(path);
		})
		.match(
			() => {
				logger.info("handleCopyStreamingLogPath: copy succeeded", { sessionId });
				toast.success(m.file_list_copy_path_toast());
			},
			(error) => {
				logger.error("handleCopyStreamingLogPath: copy failed", {
					sessionId,
					error: error.message,
				});
				toast.error(m.file_list_copy_path_error());
			}
		);
}

async function handleOpenRawFile() {
	if (!sessionId || !sessionProjectPath) return;
	await tauriClient.shell
		.getSessionFilePath(sessionId, sessionProjectPath)
		.andThen((path) => openFileInEditor(path))
		.match(
			() => toast.success(m.thread_export_raw_success()),
			(err) => toast.error(m.session_menu_open_raw_error({ error: err.message }))
		);
}

async function handleOpenInAcepe() {
	if (!sessionId || !sessionProjectPath) return;
	await tauriClient.shell.getSessionFilePath(sessionId, sessionProjectPath).match(
		(fullPath) => {
			const parts = fullPath.split(/[/\\]/);
			const fileName = parts.pop() ?? fullPath;
			const dirPath = parts.join("/") || "/";
			panelStore.openFilePanel(fileName, dirPath, { ownerPanelId: effectivePanelId });
		},
		(err) => toast.error(m.session_menu_open_raw_error({ error: err.message }))
	);
}

async function handleExportMarkdown(): Promise<void> {
	if (!sessionId) return;
	const entries = sessionStore.getEntries(sessionId);
	const markdown = sessionEntriesToMarkdown(entries);
	await ResultAsync.fromPromise(
		navigator.clipboard.writeText(markdown),
		(e) => new Error(String(e))
	).match(
		() => toast.success(m.session_menu_export_success()),
		(err) => toast.error(m.session_menu_export_error({ error: err.message }))
	);
}

async function handleExportJson() {
	if (!sessionId) return;
	const cold = sessionStore.getSessionCold(sessionId);
	if (!cold) {
		toast.error(m.session_menu_export_error({ error: "Session not found" }));
		return;
	}
	const entries = sessionStore.getEntries(sessionId);
	copySessionToClipboard({ ...cold, entries, entryCount: entries.length }).match(
		() => toast.success(m.session_menu_export_success()),
		(err) => toast.error(m.session_menu_export_error({ error: err.message }))
	);
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
	if (!sessionId && panelId && panelConnectionState === PanelConnectionState.ERROR) {
		connectionStore.send(panelId, { type: PanelConnectionEvent.CANCEL });
		errorDismissed = false;
		return;
	}

	// Retry session creation using panel's current project and agent
	if (project && selectedAgentId) {
		void installAgentThenCreateSession(project, selectedAgentId);
	} else {
		console.warn(`Retry connection failed: Missing project or agent`, {
			panelId: effectivePanelId,
			projectPath: project?.path,
			agentId: selectedAgentId,
		});
		toast.error("Cannot retry connection: Project or agent not available.");
	}
}

function handleCancelConnection() {
	// For now, just show a message that cancellation is not implemented
	// In the future, this could cancel any pending session creation
	toast.info("Connection cancellation not yet implemented.");
}

function handleDismissError() {
	errorDismissed = true;
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
		agentId: sessionAgentId ?? selectedAgentId ?? "unknown",
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
		entryCount: sessionEntries.length,
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
		// Load checkpoints when opening
		isLoadingCheckpoints = true;
		await checkpointStore.loadCheckpoints(sessionId);
		isLoadingCheckpoints = false;
	}
	showCheckpointTimeline = !showCheckpointTimeline;
}

function handleCloseCheckpointTimeline() {
	showCheckpointTimeline = false;
}

function handleCheckpointRevertComplete() {
	// Reload checkpoints after a revert (new safety checkpoint may have been created)
	if (sessionId) {
		checkpointStore.loadCheckpoints(sessionId);
	}
}

const todoManager = getTodoStateManager();
const todoState = $derived.by(() => {
	if (!sessionId) return null;
	const threadData: ThreadWithEntries = {
		entries: sessionEntries,
		isConnected: sessionHotState?.isConnected ?? false,
		status: sessionStatus ?? "idle",
		isStreaming: sessionIsStreaming,
	};
	const result = todoManager.getTodoState(sessionId, threadData);
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
			todo.status === "completed" ? "Done"
				: todo.status === "in_progress" ? "Running"
				: todo.status === "cancelled" ? "Cancelled"
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
			{sessionId}
			{sessionTitle}
			{sessionAgentId}
			{agentIconSrc}
			{agentName}
			{isFullscreen}
			{hideProjectBadge}
			{sequenceId}
			sessionStatus={mappedSessionStatus}
			projectName={displayProjectName}
			{projectColor}
			{projectIconSrc}
			{debugPanelState}
			onClose={handleClose}
			{onToggleFullscreen}
			onScrollToTop={scrollToTop}
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
		/>
		</div>
	{/snippet}

	{#snippet leadingPane()}
		{#if panelId && attachedFilePanels.length > 0}
			<AgentAttachedFilePane
				ownerPanelId={panelId}
				filePanels={attachedFilePanels}
				activeFilePanelId={activeAttachedFilePanelId}
				projects={allProjects}
				columnWidth={ATTACHED_COLUMN_WIDTH}
				isFullscreenEmbedded={isFullscreen}
				onSelectFilePanel={(ownerPanelId, filePanelId) =>
					onSelectAttachedFilePanel?.(ownerPanelId, filePanelId)}
				onCloseFilePanel={(filePanelId) => onCloseAttachedFilePanel?.(filePanelId)}
				onResizeFilePanel={(filePanelId, delta) =>
					onResizeAttachedFilePanel?.(filePanelId, delta)}
			/>
		{/if}

		{#if reviewFilesState}
			<div
				class="flex h-full min-h-0 shrink-0 flex-col border-r border-border"
				style="min-width: {REVIEW_COLUMN_WIDTH}px; width: {REVIEW_COLUMN_WIDTH}px; max-width: {REVIEW_COLUMN_WIDTH}px; flex-basis: {REVIEW_COLUMN_WIDTH}px;"
				style:display={reviewMode ? undefined : "none"}
			>
				<AgentPanelReviewContent
					modifiedFilesState={reviewFilesState}
					selectedFileIndex={clampedReviewFileIndex}
					{sessionId}
					projectPath={sessionProjectPath}
					isActive={reviewMode}
					onClose={() => onExitReviewMode?.()}
					onFileIndexChange={(index) => onReviewFileIndexChange?.(index)}
					onExpandToFullscreen={sessionId && onOpenFullscreenReview
						? () => onOpenFullscreenReview(sessionId, clampedReviewFileIndex)
						: undefined}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet topBar()}
		{#if hasPlan && planState.plan && panelId && !showPlanSidebar}
			<SharedPlanHeader
				title={planState.plan.title}
				isExpanded={showPlanSidebar}
				expandLabel={m.plan_sidebar_expand()}
				collapseLabel={m.plan_sidebar_collapse()}
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
	{/snippet}

	{#snippet body()}
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
					panelId={effectivePanelId}
					{viewState}
					{sessionId}
					sessionProjectPath={effectiveProjectPath ?? sessionProjectPath}
				/>
			</div>
			{#if viewState.kind === "conversation" && !contentIsAtTop}
				<div class="absolute top-4 left-1/2 -translate-x-1/2 z-10">
					<button
						class="h-8 w-8 flex items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-muted transition-colors"
						onclick={scrollToTop}
						aria-label={m.agent_panel_scroll_top()}
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
	{/snippet}

	{#snippet preComposer()}
		{#if viewState.kind === "conversation" || viewState.kind === "ready" || viewState.kind === "error"}
			{#if worktreeDeleted}
				<div class="{centeredFullscreenContent ? 'flex justify-center' : ''} px-5 mb-2">
					<div class="flex justify-center {centeredFullscreenContent ? 'w-full max-w-4xl' : ''}">
						<div class="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-accent">
							<Tree class="size-3 shrink-0 text-destructive" weight="fill" />
							<span class="text-[0.6875rem] text-muted-foreground">
								{m.worktree_deleted_banner()}
							</span>
						</div>
					</div>
				</div>
			{/if}
			<div class="flex shrink-0 flex-col gap-0.5 pb-1">
				<div class={centeredFullscreenContent ? "flex justify-center" : ""}>
					<div class={centeredFullscreenContent ? "w-full max-w-[60%]" : ""}>
						<div class="flex flex-col gap-0.5 px-5">
							{#if showInlineErrorCard}
								<AgentErrorCard
									title={errorInfo.title}
									summary={errorInfo.summary ?? "Failed to connect to agent"}
									details={errorInfo.details ?? "Unknown error"}
									referenceId={inlineErrorReferenceId}
									referenceSearchable={inlineErrorReferenceSearchable}
									onRetry={handleRetryConnection}
									onDismiss={handleDismissError}
									onCopyReferenceId={handleCopyInlineErrorReference}
									issueActionLabel={inlineErrorIssueDraft
										? resolveIssueActionLabel(inlineErrorIssueDraft)
										: "Create issue"}
									onIssueAction={inlineErrorIssueDraft ? handleIssueFromInlineError : undefined}
								/>
							{/if}
							{#if showPreSessionWorktreeCard && worktreeToggleProjectPath}
								<PreSessionWorktreeCard
									pendingWorktreeEnabled={worktreePending}
									alwaysEnabled={getWorktreeDefaultStore().globalDefault}
									failureMessage={preSessionWorktreeFailure}
									projectPath={worktreeToggleProjectPath}
									projectName={effectiveProjectName ?? null}
									onYes={() => {
										preSessionWorktreeFailure = null;
										const store = getWorktreeDefaultStore();
										if (store.globalDefault) {
											void store.set(false);
										}
										if (panelId) {
											panelStore.setPendingWorktreeEnabled(panelId, true);
										}
									}}
									onNo={() => {
										preSessionWorktreeFailure = null;
										const store = getWorktreeDefaultStore();
										if (store.globalDefault) {
											void store.set(false);
										}
										if (panelId) {
											if (panelPreparedWorktreeLaunch) {
												void tauriClient.git
													.discardPreparedWorktreeSessionLaunch(
														panelPreparedWorktreeLaunch.launchToken,
														true
													)
													.match(
														() => {
															panelStore.clearPreparedWorktreeLaunch(panelId);
														},
														(error) => {
															toast.error(
																`Failed to discard prepared worktree: ${error.message}`
															);
														}
													);
											}
											panelStore.setPendingWorktreeEnabled(panelId, false);
										}
									}}
									onAlways={() => {
										preSessionWorktreeFailure = null;
										const store = getWorktreeDefaultStore();
										const toggled = !store.globalDefault;
										void store.set(toggled);
										if (panelId) {
											panelStore.setPendingWorktreeEnabled(panelId, toggled);
										}
									}}
									onDismiss={() => {
										preSessionWorktreeFailure = null;
										if (panelId) {
											if (panelPreparedWorktreeLaunch) {
												void tauriClient.git
													.discardPreparedWorktreeSessionLaunch(
														panelPreparedWorktreeLaunch.launchToken,
														true
													)
													.match(
														() => {
															panelStore.clearPreparedWorktreeLaunch(panelId);
														},
														(error) => {
															toast.error(
																`Failed to discard prepared worktree: ${error.message}`
															);
														}
													);
											}
											panelStore.setPendingWorktreeEnabled(panelId, false);
										}
									}}
									onRetry={worktreePending ? handleRetryWorktree : undefined}
								/>
							{/if}
							{#if worktreeSetupState?.isVisible}
								<WorktreeSetupCard state={worktreeSetupState} />
							{/if}
							{#if agentInstallState}
								<AgentInstallCard
									agentId={agentInstallState.agentId}
									agentName={agentInstallState.agentName}
									stage={agentInstallState.stage}
									progress={agentInstallState.progress}
								/>
							{/if}
							{#if sessionId}
								<PermissionBar
									sessionId={sessionId}
									projectPath={effectiveProjectPath ?? sessionProjectPath}
									entries={sessionEntries}
									turnState={sessionHotState?.turnState ?? "idle"}
								/>
							{/if}
							{#if effectivePathForGit && (createdPr || createPrRunning || streamingShipData)}
								{#key prCardRenderKey}
									<PrStatusCard
										projectPath={effectivePathForGit}
										prNumber={createdPr}
										isCreating={createPrRunning}
										prDetails={prDetails}
										fetchError={prFetchError}
										streamingData={streamingShipData}
									/>
								{/key}
							{/if}
							{#if modifiedFilesState}
								<ModifiedFilesHeader
									{modifiedFilesState}
									{sessionId}
									{onEnterReviewMode}
									onOpenFullscreenReview={onOpenFullscreenReview && sessionId
										? (_, fileIndex) => onOpenFullscreenReview(sessionId, fileIndex)
										: undefined}
									onCreatePr={createdPr ? undefined : (config) => void handleCreatePr(config)}
									createPrLoading={createPrRunning}
									{createPrLabel}
									onMerge={createdPr && prDetails && prDetails.state !== "MERGED"
										? (strategy) => void handleMergePr(strategy)
										: undefined}
									merging={mergePrRunning}
									prState={prDetails ? prDetails.state : null}
									{availableAgents}
									currentAgentId={sessionAgentId ? sessionAgentId : selectedAgentId}
									currentModelId={sessionCurrentModelId}
									{effectiveTheme}
								/>
							{/if}
							{#if showTodoHeader && todoState}
								<SharedTodoHeader
									items={todoState.items}
									currentTask={todoState.currentTask}
									completedCount={todoState.completedCount}
									totalCount={todoState.totalCount}
									isLive={todoState.isLive}
									allCompletedLabel={m.todo_all_completed()}
									pausedLabel={m.todo_tasks_paused()}
								>
									{#snippet copyButton()}
										<CopyButton getText={getTodoMarkdown} size={12} variant="icon" class="p-0.5" stopPropagation />
									{/snippet}
								</SharedTodoHeader>
							{/if}
							{#if sessionId && queueMessages.length > 0}
								<SharedQueueCardStrip
									messages={queueMessages.map((msg) => ({
										id: msg.id,
										content: msg.content,
										attachmentCount: msg.attachments.length,
										attachments: msg.attachments.map((a) => ({
											id: a.id,
											displayName: a.displayName,
											extension: a.extension || null,
											kind: a.type === "image" ? "image" as const : a.type === "text" ? "other" as const : "file" as const,
										})),
									}))}
									isPaused={queueIsPaused}
									queueLabel={m.agent_input_queued_messages()}
									pausedLabel={m.agent_input_queue_paused()}
									resumeLabel={m.agent_input_queue_resume()}
									clearLabel={m.agent_input_queue_clear()}
									sendLabel={m.agent_input_queue_send_now()}
									cancelLabel={m.common_cancel()}
									onCancel={(messageId) => {
										if (!sessionId || !agentInputRef) {
											return;
										}
										const queuedMessage = queueMessages.find((message) => message.id === messageId);
										if (!queuedMessage) {
											return;
										}
										agentInputRef.restoreQueuedMessage(
											queuedMessage.content,
											queuedMessage.attachments
										);
										messageQueueStore.removeMessage(sessionId, messageId);
									}}
									onRemoveAttachment={(messageId, attachmentId) => {
										if (sessionId) messageQueueStore.removeAttachmentFromMessage(sessionId, messageId, attachmentId);
									}}
									onClear={() => { if (sessionId) messageQueueStore.clearQueue(sessionId); }}
									onResume={queueIsPaused && sessionId ? () => messageQueueStore.resume(sessionId) : undefined}
									onSendNow={(messageId) => {
										if (sessionId) messageQueueStore.sendNow(sessionId, messageId);
									}}
								/>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/snippet}

	{#snippet composer()}
		{#if viewState.kind === "conversation" || viewState.kind === "ready" || viewState.kind === "error"}
			<SharedAgentPanelComposerFrame
				centered={centeredFullscreenContent}
				widthClass="max-w-[60%]"
			>
				{#key inputRenderKey}
					<AgentInput
						bind:this={agentInputRef}
						sessionId={sessionId ?? undefined}
						{sessionStatus}
						sessionIsConnected={sessionHotState?.isConnected ?? false}
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
									title={m.checkpoint_toggle_tooltip()}
									ariaLabel={m.checkpoint_toggle_tooltip()}
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
	{/snippet}

	{#snippet footer()}
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
					? m.embedded_terminal_toggle_tooltip()
					: m.embedded_terminal_no_cwd_tooltip()}
				terminalAriaLabel={m.embedded_terminal_toggle_tooltip()}
				onToggleTerminal={() => {
					if (panelId && effectivePathForGit) {
						panelStore.toggleEmbeddedTerminalDrawer(panelId, effectivePathForGit);
					}
				}}
			>
				{#snippet left()}
					{#if footerWorktreeStatus}
						<SharedWorktreeStatusDisplay
							mode={footerWorktreeStatus.mode}
							primaryLabel={footerWorktreeStatus.primaryLabel}
							secondaryLabel={footerWorktreeStatus.secondaryLabel}
						/>
					{/if}
				{/snippet}
			</SharedFooter>
		{/if}
	{/snippet}

	{#snippet bottomDrawer()}
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
	{/snippet}

	{#snippet trailingPane()}
		{#if hasPlan && planState.plan && showPlanSidebar && panelId}
			<PlanSidebar
				plan={planState.plan}
				projectPath={sessionProjectPath ?? undefined}
				sessionId={sessionId ?? undefined}
				columnWidth={PLAN_SIDEBAR_COLUMN_WIDTH}
				onOpenFullscreen={() => panelState.openPlanDialog()}
				onClose={() => panelStore.setPlanSidebarExpanded(panelId, false)}
				onSendMessage={async (sid, message) => {
					await sessionStore.sendMessage(sid, message).match(
						() => {},
						(error) => { throw error; }
					);
				}}
			/>
		{/if}

		{#if showBrowserSidebar && panelId}
			<div
				class="flex flex-col h-full border-l border-border/50 shrink-0"
				style="min-width: {BROWSER_SIDEBAR_COLUMN_WIDTH}px; width: {BROWSER_SIDEBAR_COLUMN_WIDTH}px; max-width: {BROWSER_SIDEBAR_COLUMN_WIDTH}px;"
			>
				<BrowserPanelComponent
					panelId="embedded-browser-{panelId}"
					url={browserSidebarUrl ?? "https://www.google.com"}
					title="Browser"
					width={BROWSER_SIDEBAR_COLUMN_WIDTH}
					isFillContainer={true}
					onClose={() => panelStore.setBrowserSidebarExpanded(panelId, false)}
					onResize={() => {}}
				/>
			</div>
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

<Popover.Root bind:open={worktreeCloseConfirming}>
	<Popover.Content
		align="end"
		customAnchor={headerRef}
		class="w-52 p-0 overflow-hidden"
		onInteractOutside={handleWorktreeCloseCancel}
	>
		<div class="px-2 py-2">
			<p class="text-[11px] font-medium">
				{worktreeDirtyCheckPending
					? m.worktree_toggle_checking()
					: worktreeHasDirtyChanges
					? m.worktree_close_confirm_dirty_title({ name: _activeWorktreeName ?? "worktree" })
					: m.worktree_close_confirm_title({ name: _activeWorktreeName ?? "worktree" })}
			</p>
			<p class="text-[10px] text-muted-foreground leading-snug mt-0.5">
				{m.worktree_close_confirm_description()}
			</p>
		</div>
		<div class="flex items-stretch border-t border-border/30">
			<button
				type="button"
				class="flex-1 flex items-center justify-center px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer border-r border-border/30"
				onclick={handleWorktreeCloseCancel}
			>
				{m.common_cancel()}
			</button>
			<button
				type="button"
				class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
				onclick={handleWorktreeRemoveAndClose}
				disabled={worktreeDirtyCheckPending}
			>
				<Trash class="size-3" weight="fill" />
				{m.common_confirm()}
			</button>
		</div>
	</Popover.Content>
</Popover.Root>
