<script lang="ts">
/**
 * Git Panel — Smart wrapper that connects @acepe/ui GitPanelLayout
 * to Tauri backend git commands. Manages all reactive state, data fetching,
 * and mutation callbacks.
 */

import {
	AgentInputMicButton,
	CloseAction,
	EmbeddedPanelHeader,
	FilePathBadge,
	GitHubBadge,
	HeaderActionCell,
	HeaderCell,
	HeaderTitleCell,
	MarkdownDisplay,
	ProjectLetterBadge,
	getMicButtonVisualState,
} from "@acepe/ui";
import { GitPanelLayout, type GitLogEntryFile as UILogEntryFile } from "@acepe/ui/git-panel";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitBranch } from "phosphor-svelte";
import { GitPullRequest } from "phosphor-svelte";
import { Tree } from "phosphor-svelte";
import { X } from "phosphor-svelte";
import { onMount, untrack } from "svelte";
import { toast } from "svelte-sonner";
import type { CommitDiff } from "$lib/acp/types/github-integration.js";
import type { WorktreeInfo } from "$lib/acp/types/worktree-info.js";
import { handleVoiceMicKeyDown } from "../agent-input/logic/voice-mic-keyboard.js";
import { resolveVoiceMicTooltip } from "../agent-input/logic/voice-mic-labels.js";
import { normalizeVoiceInputText } from "../agent-input/logic/voice-input-text.js";
import {
	canCancelVoiceInteraction,
	canStartVoiceInteraction,
} from "../agent-input/logic/voice-ui-state.js";
import { VoiceInputState } from "../agent-input/state/voice-input-state.svelte.js";
import PrStateIcon from "../pr-state-icon.svelte";
import type {
	GitLogEntry,
	GitPanelFileStatus,
	GitRemoteStatus,
	GitStackedAction,
	GitStackedActionResult,
	GitStashEntry,
} from "$lib/utils/tauri-client/git.js";

import { revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
import { getErrorCauseDetails } from "../../errors/error-cause-details.js";
import {
	fetchCommitDiff,
	fetchPrDiff,
	fetchWorkingFileDiff,
	getRepoContext,
	listPullRequests,
} from "../../services/github-service.js";
import {
	buildWorktreeListItems,
	normalizeCommitLookupQuery,
	resolveCurrentWorktree,
} from "../../store/git-modal-state.js";
import type { GitPanelInitialTarget } from "../../store/git-panel-type.js";
import {
	buildCommitPushPrSuccessMessage,
	buildNavigableChangesFiles,
	computeCanCommitPush,
	computeCanCommitPushPr,
	computeNextChangesFileIndex,
	isChangesNavigationKey,
	mapStagedFiles,
	mapUiLogEntries,
	mapUiRemoteStatus,
	mapUiStashEntries,
	mapUnstagedFiles,
} from "./git-panel-logic.js";
import type { PrDiff, PrListItem, RepoContext } from "../../types/github-integration.js";
import type { FileDiff as FileDiffType } from "../../types/github-integration.js";
import type { GitHubReference } from "../../constants/github-badge-html.js";
import { getVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";

import PierreDiffView from "../diff-viewer/pierre-diff-view.svelte";
import PrDiffFileList from "./pr-diff-file-list.svelte";
import GitPanelWorktreesSection from "./git-panel-worktrees-section.svelte";

type SourceControlSection = "changes" | "worktrees" | "commits" | "prs";

interface Props {
	panelId: string;
	projectPath: string;
	projectName: string;
	projectColor: string | undefined;
	projectIconSrc?: string | null;
	width: number;
	initialTarget?: GitPanelInitialTarget;
	voiceSessionId?: string | null;
	isFullscreenEmbedded?: boolean;
	hideProjectBadge?: boolean;
	hideHeaderClose?: boolean;
	onClose: () => void;
	onResize: (panelId: string, delta: number) => void;
	/** Callback to send a generation prompt to the active ACP session */
	onRequestGeneration?: (prompt: string) => void;
}

let {
	panelId,
	projectPath,
	projectName,
	projectColor,
	projectIconSrc = null,
	width,
	initialTarget,
	voiceSessionId = null,
	isFullscreenEmbedded = false,
	hideProjectBadge = false,
	hideHeaderClose = false,
	onClose,
	onResize,
	onRequestGeneration,
}: Props = $props();

const initialTargetSnapshot = untrack(() => initialTarget);

// ─── Reactive State ──────────────────────────────────────────────────

let files = $state<GitPanelFileStatus[]>([]);
let branch = $state<string | null>(null);
let remoteStatus = $state<GitRemoteStatus | null>(null);
let stashEntries = $state<GitStashEntry[]>([]);
let logEntries = $state<GitLogEntry[]>([]);
let commitMessage = $state("");
let activeView = $state<"status" | "history" | "stash">("status");
let generating = $state(false);
let activeSection = $state<SourceControlSection>("changes");
let voiceState = $state<VoiceInputState | null>(null);
let commitLookup = $state("");
let commitLookupLoading = $state(false);
let commitLookupError = $state<string | null>(null);
let selectedCommitDiff = $state<CommitDiff | null>(null);
let prList = $state<PrListItem[]>([]);
let prListLoading = $state(false);
let prListError = $state<string | null>(null);
let prStateFilter = $state<"open" | "closed" | "all">("open");
let selectedPrDiff = $state<PrDiff | null>(null);
let selectedPrLoading = $state(false);
let _loading = $state(false);
let cachedRepoContext = $state<RepoContext | null>(null);
let expandedCommitFiles = $state<Record<string, UILogEntryFile[]>>({});
let worktrees = $state<WorktreeInfo[]>([]);
let worktreeDeleteConfirm = $state<string | "all" | null>(null);
let selectedChangesFile = $state<string>("");
let selectedChangesDiff = $state<FileDiffType | null>(null);
let selectedChangesLoading = $state(false);
let selectedChangesDismissed = $state(false);
let selectedChangesRequestId = $state(0);
let stackedActionRunning = $state(false);

// ─── Resize State ────────────────────────────────────────────────────

let isDragging = $state(false);
let startX = $state(0);

// ─── Derived ─────────────────────────────────────────────────────────

const effectiveColor = $derived(projectColor ?? "");
const voiceSettingsStore = getVoiceSettingsStore();
const voiceEnabled = $derived(voiceSettingsStore.enabled);
const widthStyle = $derived(
	isFullscreenEmbedded
		? "min-width: 0; width: 100%; max-width: 100%;"
		: `min-width: ${width}px; width: ${width}px; max-width: ${width}px;`
);
const surfaceClass = $derived(
	isFullscreenEmbedded
		? "rounded border-border bg-input/30"
		: "rounded-lg border-border/60 bg-background shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
);
const currentWorktree = $derived(resolveCurrentWorktree(projectPath, worktrees));
const worktreeItems = $derived(buildWorktreeListItems(projectPath, worktrees));

/** Map Tauri file status → shared UI GitStatusFile */
const stagedFiles = $derived(mapStagedFiles(files));

const unstagedFiles = $derived(mapUnstagedFiles(files));

const navigableChangesFiles = $derived(buildNavigableChangesFiles(stagedFiles, unstagedFiles));

/** Map Tauri types → shared UI types */
const uiRemoteStatus = $derived(mapUiRemoteStatus(remoteStatus));

const uiStashEntries = $derived(mapUiStashEntries(stashEntries));

const uiLogEntries = $derived(mapUiLogEntries(logEntries));

const canCommitPush = $derived(
	computeCanCommitPush({
		stagedFileCount: stagedFiles.length,
		remoteStatus,
		branch,
		stackedActionRunning,
	})
);
const canCommitPushPr = $derived(computeCanCommitPushPr({ canCommitPush, remoteStatus }));
const commitMicDisabled = $derived.by(() => {
	if (voiceState === null) {
		return true;
	}

	return (
		!canStartVoiceInteraction(voiceState.phase, false) &&
		!canCancelVoiceInteraction(voiceState.phase)
	);
});

const voiceMicTooltipLabels = {
	downloadingModel: "Downloading speech model…",
	loadingModel: "Loading model...",
	checkingPermission: "Checking...",
	transcribing: "Transcribing…",
	stopRecording: "Stop recording",
	startRecording: "Start voice recording",
} as const;

onMount(() => {
	if (!voiceEnabled || !voiceSessionId) {
		return;
	}

	const nextVoiceState = new VoiceInputState({
		sessionId: voiceSessionId,
		getSelectedLanguage: () => voiceSettingsStore.language,
		getSelectedModelId: () => voiceSettingsStore.selectedModelId,
		onTranscriptionReady: (text) => {
			const normalizedText = normalizeVoiceInputText(text);
			if (!normalizedText) {
				return;
			}

			commitMessage =
				commitMessage.length > 0 ? `${commitMessage} ${normalizedText}` : normalizedText;
		},
	});
	let disposed = false;
	void nextVoiceState.registerListeners().then(() => {
		if (disposed) {
			nextVoiceState.dispose();
			return;
		}
		voiceState = nextVoiceState;
	});

	return () => {
		disposed = true;
		voiceState = null;
		nextVoiceState.dispose();
	};
});

// ─── Data Fetching ───────────────────────────────────────────────────

async function refresh() {
	_loading = true;
	const [statusResult, branchResult, remoteResult, worktreeResult] = await Promise.all([
		tauriClient.git.panelStatus(projectPath),
		tauriClient.git.currentBranch(projectPath),
		tauriClient.git.remoteStatus(projectPath),
		tauriClient.git.worktreeList(projectPath),
	]);

	statusResult.map((f) => (files = f));
	branchResult.map((b) => (branch = b));
	remoteResult.map((r) => (remoteStatus = r));
	worktreeResult.map((items) => (worktrees = items));
	selectedChangesFile = "";
	selectedChangesDiff = null;
	selectedChangesLoading = false;
	selectedChangesDismissed = false;
	selectedChangesRequestId += 1;

	_loading = false;
}

$effect(() => {
	if (
		activeSection !== "changes" ||
		activeView !== "status" ||
		_loading ||
		selectedChangesDismissed ||
		selectedChangesFile ||
		navigableChangesFiles.length === 0
	) {
		return;
	}

	const [firstFile] = navigableChangesFiles;
	if (firstFile) {
		void handleFileSelect(firstFile.file, firstFile.staged);
	}
});

async function loadStash() {
	const result = await tauriClient.git.stashList(projectPath);
	result.map((s) => (stashEntries = s));
}

async function loadLog() {
	const result = await tauriClient.git.log(projectPath, 50);
	result.map((l) => (logEntries = l));
}

// Load initial data on mount (deferred when opening a PR directly)
if (!initialTargetSnapshot?.prNumber) {
	void refresh();
}

// Watch for external branch changes via .git/HEAD file watcher
// Deferred when opening a specific PR to avoid competing for the thread pool.
let watchHeadInitialized = false;
function initWatchHead() {
	if (watchHeadInitialized) return;
	watchHeadInitialized = true;
	void tauriClient.git.watchHead(projectPath);
	void listen<{ projectPath: string; branch: string | null }>("git:head-changed", (event) => {
		if (event.payload.projectPath === projectPath) {
			refresh();
		}
	});
}
if (!initialTargetSnapshot?.prNumber) {
	initWatchHead();
}

// ─── Mutation Callbacks ──────────────────────────────────────────────

async function handleStage(path: string) {
	await tauriClient.git.stageFiles(projectPath, [path]);
	await refresh();
}

async function handleUnstage(path: string) {
	await tauriClient.git.unstageFiles(projectPath, [path]);
	await refresh();
}

async function handleStageAll() {
	await tauriClient.git.stageAll(projectPath);
	await refresh();
}

async function handleDiscard(path: string) {
	await tauriClient.git.discardChanges(projectPath, [path]);
	await refresh();
}

async function handleCommit(message: string) {
	const result = await tauriClient.git.commit(projectPath, message);
	result.map(() => {
		commitMessage = "";
	});
	await refresh();
	// Refresh log if on history tab
	if (activeView === "history") await loadLog();
}

async function handlePush() {
	await tauriClient.git.push(projectPath);
	const result = await tauriClient.git.remoteStatus(projectPath);
	result.map((r) => (remoteStatus = r));
}

async function runStackedActionAndNotify(
	action: GitStackedAction,
	successMessage: (result: GitStackedActionResult) => string,
	openPrUrl?: (result: GitStackedActionResult) => void
) {
	stackedActionRunning = true;
	console.info("[git-panel] runStackedAction", { projectPath, action, commitMessage });
	const result = await tauriClient.git.runStackedAction(projectPath, action, commitMessage);
	await result.match(
		async (ok) => {
			stackedActionRunning = false;
			console.info("[git-panel] runStackedAction success", {
				action: ok.action,
				commitStatus: ok.commit.status,
				pushStatus: ok.push.status,
				prStatus: ok.pr.status,
				prUrl: ok.pr.url,
			});
			toast.success(successMessage(ok));
			if (openPrUrl) openPrUrl(ok);
			commitMessage = "";
			await Promise.all([refresh(), activeView === "history" ? loadLog() : Promise.resolve()]);
		},
		(err) => {
			stackedActionRunning = false;
			const details = getErrorCauseDetails(err);
			console.error("[git-panel] runStackedAction failed", {
				message: err.message,
				rootCause: details.rootCause,
				chain: details.chain,
				formatted: details.formatted,
			});
			toast.error(details.rootCause ?? err.message);
		}
	);
}

async function handleCommitPush() {
	await runStackedActionAndNotify("commit_push", () => "Pushed to branch");
}

async function handleCommitPushPr() {
	await runStackedActionAndNotify(
		"commit_push_pr",
		(ok) => buildCommitPushPrSuccessMessage(ok.pr),
		(ok) => {
			if (ok.pr.status === "created" || ok.pr.status === "opened_existing") {
				// Backend guarantees pr.url for these statuses.
				if (ok.pr.url) void openUrl(ok.pr.url).catch(() => {});
			}
		}
	);
}

async function handleGenerate() {
	if (!onRequestGeneration || generating) return;
	generating = true;
	const result = await tauriClient.git.collectShipContext(projectPath);
	result.match(
		(ctx) => {
			if (!ctx) {
				toast.warning("No staged changes to generate from");
				generating = false;
				return;
			}
			onRequestGeneration(ctx.prompt);
			generating = false;
		},
		(err) => {
			toast.error(`Generation failed: ${err.message}`);
			generating = false;
		}
	);
}

async function handlePull() {
	await tauriClient.git.pull(projectPath);
	await refresh();
}

async function handleFetch() {
	await tauriClient.git.fetch(projectPath);
	const result = await tauriClient.git.remoteStatus(projectPath);
	result.map((r) => (remoteStatus = r));
}

function handleViewChange(view: "status" | "history" | "stash") {
	activeView = view;
	if (view === "stash") loadStash();
	if (view === "history") loadLog();
}

async function handleStashPop(index: number) {
	await tauriClient.git.stashPop(projectPath, index);
	await refresh();
	await loadStash();
}

async function handleStashDrop(index: number) {
	await tauriClient.git.stashDrop(projectPath, index);
	await loadStash();
}

async function handleLogExpand(sha: string) {
	// Skip if already loaded
	if (expandedCommitFiles[sha]) return;

	const result = await fetchCommitDiff(sha, projectPath);
	result.match(
		(commitDiff) => {
			expandedCommitFiles[sha] = commitDiff.files.map((f) => ({
				path: f.path,
				status: f.status,
				additions: f.additions,
				deletions: f.deletions,
				patch: f.patch,
			}));
		},
		() => {
			// On error, set empty array so it doesn't show loading forever
			expandedCommitFiles[sha] = [];
		}
	);
}

// ─── Resize Handlers ─────────────────────────────────────────────────

function handlePointerDown(e: PointerEvent) {
	isDragging = true;
	startX = e.clientX;
	(e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
	if (!isDragging) return;
	const delta = e.clientX - startX;
	startX = e.clientX;
	onResize(panelId, delta);
}

function handlePointerUp() {
	isDragging = false;
}

function handleRevealPath(path: string) {
	revealInFinder(path).mapErr(() => undefined);
}

async function handleDeleteWorktree(directory: string) {
	await tauriClient.git.worktreeRemove(directory, false);
	worktreeDeleteConfirm = null;
	await refresh();
}

async function handleDeleteAllWorktrees() {
	for (const item of worktreeItems) {
		await tauriClient.git.worktreeRemove(item.worktree.directory, false);
	}
	worktreeDeleteConfirm = null;
	await refresh();
}

async function handleFileSelect(
	file: {
		path: string;
		status: FileDiffType["status"];
		additions: number;
		deletions: number;
	},
	staged: boolean
) {
	const requestId = selectedChangesRequestId + 1;
	selectedChangesRequestId = requestId;
	selectedChangesFile = file.path;
	selectedChangesDiff = {
		path: file.path,
		status: file.status,
		additions: file.additions,
		deletions: file.deletions,
		patch: "",
	};
	selectedChangesLoading = true;
	selectedChangesDismissed = false;

	const result = await fetchWorkingFileDiff(
		projectPath,
		file.path,
		staged,
		file.status,
		file.additions,
		file.deletions
	);
	result.match(
		(diff) => {
			if (requestId !== selectedChangesRequestId) {
				return;
			}
			selectedChangesDiff = diff;
			selectedChangesLoading = false;
		},
		() => {
			if (requestId !== selectedChangesRequestId) {
				return;
			}
			selectedChangesDiff = null;
			selectedChangesLoading = false;
		}
	);
}

function closeSelectedChangesPreview() {
	selectedChangesRequestId += 1;
	selectedChangesFile = "";
	selectedChangesDiff = null;
	selectedChangesLoading = false;
	selectedChangesDismissed = true;
}

function handleChangesKeyDown(event: KeyboardEvent) {
	if (
		activeSection !== "changes" ||
		activeView !== "status" ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		navigableChangesFiles.length === 0
	) {
		return;
	}

	const target = event.target;
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLButtonElement === false &&
			target instanceof HTMLElement &&
			target.isContentEditable)
	) {
		return;
	}

	if (!isChangesNavigationKey(event.key)) {
		return;
	}

	event.preventDefault();

	const currentIndex = navigableChangesFiles.findIndex(
		(entry) => entry.file.path === selectedChangesFile
	);
	const nextIndex = computeNextChangesFileIndex({
		key: event.key,
		currentIndex,
		length: navigableChangesFiles.length,
	});
	const nextFile = navigableChangesFiles[nextIndex];
	if (!nextFile || nextFile.file.path === selectedChangesFile) {
		return;
	}

	void handleFileSelect(nextFile.file, nextFile.staged);
}

async function handleOpenCommit(rawQuery: string) {
	const normalizedQuery = normalizeCommitLookupQuery(rawQuery);
	if (!normalizedQuery) {
		commitLookupError = "Enter a commit SHA to inspect.";
		return;
	}

	commitLookupLoading = true;
	commitLookupError = null;
	commitLookup = normalizedQuery;

	const result = await fetchCommitDiff(normalizedQuery, projectPath);
	result.match(
		(diff) => {
			selectedCommitDiff = diff;
			commitLookup = diff.sha;
		},
		(error) => {
			commitLookupError = error.message;
		}
	);

	commitLookupLoading = false;
}

function openCommitsSection() {
	activeSection = "commits";
	if (logEntries.length === 0) {
		void loadLog();
	}
}

async function loadPrList() {
	prListLoading = true;
	prListError = null;

	const ctxResult = await getRepoContext(projectPath);
	await ctxResult.match(
		async (ctx) => {
			cachedRepoContext = ctx;
			const result = await listPullRequests(ctx.owner, ctx.repo, prStateFilter);
			result.match(
				(items) => {
					prList = items;
				},
				(error) => {
					prListError = error.message;
				}
			);
		},
		(error) => {
			prListError = error.message;
		}
	);

	prListLoading = false;
}

function openPrsSection() {
	activeSection = "prs";
	if (prList.length === 0 && !prListLoading) {
		prListLoading = true;
		void loadPrList();
	}
}

// Navigate to initial target on mount (one-time, not reactive)
if (initialTargetSnapshot) {
	if (initialTargetSnapshot.section === "commits") {
		openCommitsSection();
		if (initialTargetSnapshot.commitSha) {
			void handleOpenCommit(initialTargetSnapshot.commitSha);
		}
	} else {
		// Set loading states synchronously before async work starts,
		// so the first render already shows skeletons instead of empty state.
		selectedPrLoading = initialTargetSnapshot.prNumber !== undefined;
		activeSection = "prs";
		// When opening a specific PR, fetch it first — defer the PR list load
		// to avoid competing for the thread pool.
		if (initialTargetSnapshot.prNumber !== undefined) {
			void handleOpenPr(initialTargetSnapshot.prNumber).then(() => {
				// Load PR list and git status in the background after the PR is loaded
				if (prList.length === 0 && !prListLoading) {
					prListLoading = true;
					void loadPrList();
				}
				void refresh();
				initWatchHead();
			});
		} else {
			openPrsSection();
		}
	}
}

async function handleOpenPr(prNumber: number) {
	selectedPrLoading = true;
	const ctxResult = await getRepoContext(projectPath);
	await ctxResult.match(
		async (ctx) => {
			cachedRepoContext = ctx;
			const result = await fetchPrDiff(ctx.owner, ctx.repo, prNumber);
			result.match(
				(diff) => {
					selectedPrDiff = diff;
				},
				() => {
					selectedPrDiff = null;
				}
			);
		},
		() => {
			selectedPrDiff = null;
		}
	);
	selectedPrLoading = false;
}
</script>

<div
	class={`relative flex h-full min-h-0 shrink-0 grow-0 flex-col overflow-hidden border ${surfaceClass} ${isDragging ? "select-none" : ""}`}
	style={widthStyle}
>
	<!-- Panel Header (project chrome) -->
	<EmbeddedPanelHeader>
		{#if !hideProjectBadge}
			<HeaderCell>
				<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
					<ProjectLetterBadge
						name={projectName}
						color={effectiveColor}
						iconSrc={projectIconSrc}
						size={28}
						fontSize={15}
						class="!rounded-none !rounded-tl-lg"
					/>
				</div>
			</HeaderCell>
		{/if}

		<HeaderTitleCell>
			<div class="flex items-center gap-1.5 min-w-0">
				{#if currentWorktree}
					<span
						class="inline-flex min-w-0 items-center gap-1 rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
					>
						<Tree size={10} weight="fill" class="shrink-0 text-success" />
						<span class="truncate font-mono">{currentWorktree.name}</span>
						{#if currentWorktree.origin === "external"}
							<span class="text-[9px] uppercase tracking-wide text-muted-foreground/60">ext</span>
						{/if}
					</span>
				{/if}
			</div>
		</HeaderTitleCell>

		{#if !hideHeaderClose}
			<HeaderActionCell withDivider={true}>
				<CloseAction {onClose} />
			</HeaderActionCell>
		{/if}
	</EmbeddedPanelHeader>

	<div class="flex items-center gap-1 border-b border-border px-1 py-1 shrink-0">
		<button
			type="button"
			class={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${activeSection === "changes" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
			onclick={() => (activeSection = "changes")}
		>
			<GitBranch size={12} weight="bold" />
			<span>Changes</span>
		</button>
		<button
			type="button"
			class={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${activeSection === "worktrees" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
			onclick={() => (activeSection = "worktrees")}
		>
			<Tree size={12} weight="fill" class="text-success" />
			<span>Worktrees</span>
			{#if worktreeItems.length > 0}
				<span class="text-[10px] text-muted-foreground">({worktreeItems.length})</span>
			{/if}
		</button>
		<button
			type="button"
			class={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${activeSection === "commits" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
			onclick={openCommitsSection}
		>
			<GitBranch size={12} weight="bold" class="text-success" />
			<span>Commits</span>
		</button>
		<button
			type="button"
			class={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${activeSection === "prs" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
			onclick={openPrsSection}
		>
			<GitPullRequest size={12} weight="bold" style="color: var(--success)" />
			<span>PRs</span>
			{#if prList.length > 0}
				<span class="text-[10px] text-muted-foreground">({prList.length})</span>
			{/if}
		</button>
	</div>

	<!-- Pierre Diff snippet for inline commit file diffs -->
	{#snippet renderFileDiff({ file }: { file: UILogEntryFile })}
		{#if file.patch}
			<PierreDiffView
				diff={{
					path: file.path,
					status: file.status as FileDiffType["status"],
					additions: file.additions,
					deletions: file.deletions,
					patch: file.patch,
				}}
				viewMode="inline"
			/>
		{/if}
	{/snippet}

	{#snippet commitMicButton()}
		{#if voiceState}
			{@const currentVoiceState = voiceState}
			{@const micTitle = resolveVoiceMicTooltip(currentVoiceState.phase, voiceMicTooltipLabels)}
			<AgentInputMicButton
				visualState={getMicButtonVisualState(currentVoiceState.phase)}
				downloadPercent={currentVoiceState.downloadPercent}
				disabled={commitMicDisabled}
				title={micTitle}
				ariaLabel={micTitle}
				onpointerdown={(event) => {
					if (commitMicDisabled) {
						return;
					}
					currentVoiceState.onMicPointerDown(event);
				}}
				onpointerup={() => {
					if (commitMicDisabled) {
						return;
					}
					currentVoiceState.onMicPointerUp();
				}}
				onpointercancel={() => currentVoiceState.onMicPointerCancel()}
				onkeydown={(event) => {
					if (commitMicDisabled) {
						return;
					}
					handleVoiceMicKeyDown(event, currentVoiceState);
				}}
			/>
		{/if}
	{/snippet}

	{#snippet commitComposerActions()}
		<button
			type="button"
			class="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/20 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
			disabled={!canCommitPush}
			onclick={() => void handleCommitPush()}
		>
			Commit & push
		</button>
		<button
			type="button"
			class="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/20 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
			disabled={!canCommitPushPr}
			onclick={() => void handleCommitPushPr()}
		>
			Commit, push & create PR
		</button>
	{/snippet}

	{#if activeSection === "changes"}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="flex min-h-0 flex-1 overflow-hidden"
			role="group"
			aria-label="Git changes"
			onkeydown={handleChangesKeyDown}
		>
			<GitPanelLayout
				branch={branch ?? ""}
				{stagedFiles}
				{unstagedFiles}
				remoteStatus={uiRemoteStatus}
				{commitMessage}
				stashEntries={uiStashEntries}
				logEntries={uiLogEntries}
				{activeView}
				iconBasePath="/svgs/icons"
				onStage={handleStage}
				onUnstage={handleUnstage}
				onStageAll={handleStageAll}
				onDiscard={handleDiscard}
				onCommitMessageChange={(msg) => (commitMessage = msg)}
				onCommit={handleCommit}
				onGenerate={onRequestGeneration ? handleGenerate : undefined}
				commitActions={commitComposerActions}
				commitMicButton={commitMicButton}
				{generating}
				onPush={handlePush}
				onPull={handlePull}
				onFetch={handleFetch}
				onViewChange={handleViewChange}
				onStashPop={handleStashPop}
				onStashDrop={handleStashDrop}
				onLogExpand={handleLogExpand}
				onFileSelect={handleFileSelect}
				selectedFile={selectedChangesFile}
				{expandedCommitFiles}
				logFileDiffContent={renderFileDiff}
				class="min-h-0 min-w-0 flex-1"
			/>

			{#if selectedChangesDiff}
				<div class="flex min-h-0 w-[min(44%,480px)] min-w-[320px] flex-col border-l border-border/30 bg-background">
					<div class="flex items-center gap-2 border-b border-border/20 px-2.5 py-1.5">
						<FilePathBadge
							filePath={selectedChangesDiff.path}
							iconBasePath="/svgs/icons"
							linesAdded={selectedChangesDiff.additions}
							linesRemoved={selectedChangesDiff.deletions}
							interactive={false}
							size="sm"
							class="!border-transparent !bg-transparent !px-0 !py-0 text-foreground"
						/>
						<div class="flex-1"></div>
						<button
							type="button"
							class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
							title="Close preview"
							onclick={closeSelectedChangesPreview}
						>
							<X size={14} weight="bold" />
						</button>
					</div>
					<div class="min-h-0 flex-1 overflow-y-auto">
						{#if selectedChangesLoading}
							<div class="px-3 py-4 text-sm text-muted-foreground">
								Loading diff...
							</div>
						{:else if selectedChangesDiff.patch}
							<PierreDiffView
								diff={{
									path: selectedChangesDiff.path,
									status: selectedChangesDiff.status as FileDiffType["status"],
									additions: selectedChangesDiff.additions,
									deletions: selectedChangesDiff.deletions,
									patch: selectedChangesDiff.patch,
								}}
								viewMode="inline"
							/>
						{:else}
							<div class="px-3 py-4 text-sm text-muted-foreground">
								No textual diff is available for this file.
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{:else if activeSection === "worktrees"}
		<GitPanelWorktreesSection
			{currentWorktree}
			{branch}
			{projectPath}
			{worktreeItems}
			deleteConfirm={worktreeDeleteConfirm}
			onDeleteConfirmChange={(value) => (worktreeDeleteConfirm = value)}
			onRevealPath={handleRevealPath}
			onDeleteWorktree={(directory) => void handleDeleteWorktree(directory)}
			onDeleteAllWorktrees={() => void handleDeleteAllWorktrees()}
		/>
	{:else if activeSection === "commits"}
		<div class="flex flex-1 min-h-0 overflow-hidden">
			<div class="flex w-[16rem] shrink-0 flex-col border-r border-border/30 bg-muted/5">
				<div class="border-b border-border/30 px-2.5 py-2">
					<div class="flex items-center gap-2">
						<input
							type="text"
							class="flex-1 rounded-lg border border-border/70 bg-background px-2 py-1.5 text-xs font-mono text-foreground outline-none transition-colors focus:border-primary"
							placeholder="Paste commit SHA"
							bind:value={commitLookup}
							onkeydown={(event) => {
								if (event.key === "Enter") {
									void handleOpenCommit(commitLookup);
								}
							}}
						/>
						<button
							type="button"
							class="rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={commitLookupLoading}
							onclick={() => void handleOpenCommit(commitLookup)}
						>
							{commitLookupLoading ? "Loading" : "Open"}
						</button>
					</div>
					{#if commitLookupError}
						<p class="mt-2 text-xs text-destructive">{commitLookupError}</p>
					{/if}
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
					<div
						class="mb-1 px-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60"
					>
						Recent
					</div>
					<div class="space-y-px">
						{#each logEntries as entry (entry.sha)}
							<button
								type="button"
								class={`flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors ${selectedCommitDiff?.sha === entry.sha ? "bg-accent/15 text-foreground" : "hover:bg-muted/30"}`}
								onclick={() => void handleOpenCommit(entry.sha)}
							>
								<span class="truncate text-[11px] text-foreground leading-tight"
									>{entry.message}</span
								>
								<div class="flex items-center gap-1.5 mt-0.5">
									<span class="font-mono text-[10px] text-muted-foreground">{entry.shortSha}</span>
									<span class="text-[10px] text-muted-foreground/50">{entry.author}</span>
								</div>
							</button>
						{/each}
					</div>
				</div>
			</div>

			<div class="min-w-0 flex-1 overflow-y-auto px-3 py-2">
				{#if selectedCommitDiff}
					<div class="space-y-2">
						<div class="rounded-lg border border-border/40 bg-muted/10 px-2.5 py-2">
							<div class="flex items-center gap-1.5">
								<span
									class="rounded-md bg-accent/30 px-1.5 py-px font-mono text-[10px] text-foreground"
									>{selectedCommitDiff.shortSha}</span
								>
								<span class="font-mono text-[10px] text-muted-foreground/50 truncate"
									>{selectedCommitDiff.sha}</span
								>
							</div>
							<h3 class="mt-1.5 text-xs font-semibold text-foreground leading-snug">
								{selectedCommitDiff.message}
							</h3>
							{#if selectedCommitDiff.messageBody}
								<p
									class="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground leading-relaxed"
								>
									{selectedCommitDiff.messageBody}
								</p>
							{/if}
							<div class="mt-1.5 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
								<span>{selectedCommitDiff.author}</span>
								<span>{selectedCommitDiff.authorEmail}</span>
								<span>{selectedCommitDiff.date}</span>
							</div>
						</div>

						<div class="space-y-1.5">
							{#each selectedCommitDiff.files as file (file.path)}
								<div class="overflow-hidden rounded-lg border border-border/40">
									<div
										class="flex items-center justify-between border-b border-border/30 px-2.5 py-1.5 bg-muted/5"
									>
										<FilePathBadge
											filePath={file.path}
											linesAdded={file.additions}
											linesRemoved={file.deletions}
											interactive={false}
											size="sm"
										/>
									</div>
									{#if file.patch}
										<PierreDiffView diff={file} viewMode="inline" />
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div
						class="flex h-full items-center justify-center text-center text-[11px] text-muted-foreground/60"
					>
						Select a commit or paste a SHA.
					</div>
				{/if}
			</div>
		</div>
	{:else if activeSection === "prs"}
		<div class="flex flex-1 min-h-0 overflow-hidden">
			<!-- PR sidebar -->
			<div class="flex w-[16rem] shrink-0 flex-col border-r border-border/30 bg-muted/5">
				<div class="flex items-center gap-px border-b border-border/30 px-2 py-1.5">
					{#each ["open", "closed", "all"] as filter (filter)}
						{@const f = filter as "open" | "closed" | "all"}
						<button
							type="button"
							class={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${prStateFilter === f ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
							onclick={() => {
								prStateFilter = f;
								void loadPrList();
							}}
						>
							{f.charAt(0).toUpperCase() + f.slice(1)}
						</button>
					{/each}
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
					{#if prListLoading}
						<div class="space-y-1 px-1 py-1.5 animate-in fade-in duration-150">
							{#each { length: 5 } as _}
								<div class="rounded-md px-2 py-1.5">
									<div class="flex items-center gap-1.5">
										<span class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/20"></span>
										<span class="inline-block h-3 animate-pulse rounded bg-muted-foreground/15" style="width: {40 + Math.random() * 40}%"></span>
									</div>
									<div class="flex items-center gap-1.5 mt-1 pl-3">
										<span class="inline-block h-2.5 w-14 animate-pulse rounded bg-muted-foreground/10"></span>
										<span class="inline-block h-2.5 w-20 animate-pulse rounded bg-muted-foreground/10"></span>
									</div>
								</div>
							{/each}
						</div>
					{:else if prListError}
						<div class="px-2 py-3 text-[11px] text-destructive">{prListError}</div>
					{:else if prList.length === 0}
						<div class="flex items-center justify-center py-6 text-[11px] text-muted-foreground/60">
							No {prStateFilter} pull requests.
						</div>
					{:else}
						<div class="space-y-px">
							{#each prList as pr (pr.number)}
								{@const prState = pr.state === "open" ? "OPEN" : pr.state === "merged" ? "MERGED" : "CLOSED"}
								<button
									type="button"
									class={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors ${selectedPrDiff?.pr.number === pr.number ? "bg-accent/15 text-foreground" : "hover:bg-muted/30"}`}
									onclick={() => void handleOpenPr(pr.number)}
								>
									<span class="flex h-4 w-4 shrink-0 items-center justify-center">
										<PrStateIcon state={prState} size={13} />
									</span>
									<span class="font-mono text-[11px] text-muted-foreground shrink-0">#{pr.number}</span>
									<span class="truncate text-[11px] text-foreground leading-tight">{pr.title}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- PR detail -->
			<div class="min-w-0 flex-1 overflow-y-auto px-3 py-2">
				{#if selectedPrLoading}
					<div class="space-y-2 animate-in fade-in duration-150">
						<div class="rounded-lg border border-border/40 bg-muted/10 px-2.5 py-2">
							<div class="flex items-center gap-1.5">
								<span class="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted-foreground/20"></span>
								<span class="inline-block h-3.5 w-10 animate-pulse rounded bg-muted-foreground/15"></span>
								<span class="inline-block h-3 w-12 animate-pulse rounded bg-muted-foreground/10"></span>
							</div>
							<div class="mt-1.5 h-4 w-3/4 animate-pulse rounded bg-muted-foreground/15"></div>
							<div class="mt-2 h-3 w-full animate-pulse rounded bg-muted-foreground/10"></div>
							<div class="mt-1 h-3 w-2/3 animate-pulse rounded bg-muted-foreground/10"></div>
							<div class="mt-2 flex gap-3">
								<span class="inline-block h-3 w-16 animate-pulse rounded bg-muted-foreground/10"></span>
								<span class="inline-block h-3 w-14 animate-pulse rounded bg-muted-foreground/10"></span>
							</div>
						</div>
						<div class="space-y-1">
							{#each { length: 4 } as _}
								<div class="flex items-center gap-2 rounded-md px-1 py-1.5">
									<span class="inline-block h-3 w-3 animate-pulse rounded bg-muted-foreground/10"></span>
									<span class="inline-block h-3 w-full animate-pulse rounded bg-muted-foreground/10" style="max-width: {60 + Math.random() * 30}%"></span>
								</div>
							{/each}
						</div>
					</div>
				{:else if selectedPrDiff}
					{@const prRef = { type: "pr", owner: selectedPrDiff.repoContext.owner, repo: selectedPrDiff.repoContext.repo, number: selectedPrDiff.pr.number } as GitHubReference}
					{@const totalInsertions = selectedPrDiff.files.reduce((sum, f) => sum + f.additions, 0)}
					{@const totalDeletions = selectedPrDiff.files.reduce((sum, f) => sum + f.deletions, 0)}
					<div class="space-y-3">
						<div class="space-y-1.5">
							<div class="flex items-center gap-2">
								<GitHubBadge
									ref={prRef}
									prState={selectedPrDiff.pr.state}
									insertions={totalInsertions}
									deletions={totalDeletions}
								/>
								<span class="text-[10px] text-muted-foreground">{selectedPrDiff.pr.author}</span>
								<span class="text-[10px] text-muted-foreground/40">·</span>
								<span class="text-[10px] text-muted-foreground">
									{selectedPrDiff.files.length} file{selectedPrDiff.files.length === 1 ? "" : "s"}
								</span>
							</div>
							<h3 class="text-xs font-semibold text-foreground leading-snug">
								{selectedPrDiff.pr.title}
							</h3>
							{#if selectedPrDiff.pr.description}
								<div class="text-[11px] text-muted-foreground leading-relaxed [&_.markdown-content]:p-0 [&_.markdown-loading]:p-0 [&_p]:p-0">
									<MarkdownDisplay content={selectedPrDiff.pr.description} iconBasePath="/svgs/icons" />
								</div>
							{/if}
						</div>

						{#key selectedPrDiff.pr.number}
							<PrDiffFileList files={selectedPrDiff.files} />
						{/key}
					</div>
				{:else}
					<div
						class="flex h-full items-center justify-center text-center text-[11px] text-muted-foreground/60"
					>
						Select a pull request to view its diff.
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if !isFullscreenEmbedded}
		<!-- Resize Edge -->
		<div
			class="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
			role="separator"
			aria-orientation="vertical"
			tabindex="-1"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		></div>
	{/if}
</div>
