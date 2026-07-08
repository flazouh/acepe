<script lang="ts">
	import {
		AgentPanelStatePanel,
		type AgentPanelPerformanceRecorder,
		type AgentPanelPerformanceSample,
	} from "@acepe/ui/agent-panel";
	import { onDestroy, onMount } from "svelte";
	import { getInteractionStore } from "../../../store/interaction-store.svelte.js";
	import { deriveLiveSessionWorkProjection } from "../../../store/live-session-work.js";
	import { getSessionStore } from "../../../store/session-store.svelte.js";
	import { createLogger } from "../../../utils/logger.js";
	import ProjectSelectionPanel from "../../project-selection-panel.svelte";
	import ReadyToAssistPlaceholder from "../../ready-to-assist-placeholder.svelte";
	import { resolveAgentPanelContentRuntime } from "../logic/agent-panel-content-runtime.js";
	import {
		recordPanelOpenPerformanceMark,
		type PanelOpenPerformanceMarkName,
	} from "../logic/panel-open-performance-mark.js";
	import type { AgentPanelContentProps } from "../types/agent-panel-content-props.js";
	import SceneContentViewport from "./scene-content-viewport.svelte";

let {
	panelId,
	viewState,
	sessionId,
	sceneEntries,
	canonicalSource = null,
	rowsProjectionOverride = null,
	pendingUserRevealRequestKey = null,
	showLocalPlanningIndicator = false,
	sessionProjectPath,
	allProjects = [],
	scrollContainer = $bindable(null),
	scrollViewport = $bindable(null),
	isAtBottom = $bindable(true),
	isAtTop = $bindable(true),
	hasUnreadBelow = $bindable(false),
	isStreaming: isStreamingBindable = $bindable(false),
	onProjectSelected = () => {},
	onRetryConnection,
	onCancelConnection,
	agentIconSrc = "",
	showWorkingSpark = false,
	planningPlaceholderPresentation = null,
	isFullscreen = false,
	availableAgents = [],
	effectiveTheme = "dark",
	modifiedFilesState = null,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	onToolFileSelect,
	onUserFileSelect,
	onReview,
	isPlanActionAvailable,
}: AgentPanelContentProps = $props();

	recordPanelOpenPerformanceMark(panelId, "agent-panel-content:props");

const sessionStore = getSessionStore();
const interactionStore = getInteractionStore();
const logger = createLogger({
	id: "agent-panel-content-trace",
	name: "AgentPanelContentTrace",
});
let lastContentTraceSignature = $state<string | null>(null);
let readyPlaceholderVisible = $state(false);
let readyPlaceholderFrameId: number | null = null;
let readyPlaceholderFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let recordedRowsReadySignature: string | null = null;
let recordedBranchPanelId: string | null = null;
let recordedSceneBeforePanelId: string | null = null;
let recordedSceneAfterPanelId: string | null = null;
const recordedContentStateMarks = new Set<PanelOpenPerformanceMarkName>();
const MAX_QA_PROFILE_SAMPLES = 20_000;

type AgentPanelPerformanceCaptureWindow = Window & {
	__acepeAgentPanelPerformanceSamples?: AgentPanelPerformanceSample[];
	__acepeAgentPanelPerformanceCaptureEnabled?: boolean;
	__acepeEnableAgentPanelPerformanceCapture?: () => void;
	__acepeDisableAgentPanelPerformanceCapture?: () => void;
	__acepeReadAgentPanelPerformanceCapture?: () => readonly AgentPanelPerformanceSample[];
};

let profileCaptureEnabled = $state(isAgentPanelPerformanceCaptureEnabled());
const profileRecorder: AgentPanelPerformanceRecorder | undefined = $derived(
	profileCaptureEnabled ? recordAgentPanelPerformanceSampleForQa : undefined
);

function isAgentPanelContentTraceEnabled(): boolean {
	return (
		import.meta.env.DEV &&
		typeof localStorage !== "undefined" &&
		localStorage.getItem("acepe.agentPanelRenderTrace") === "true"
	);
}

function performanceCaptureWindow(): AgentPanelPerformanceCaptureWindow | null {
	if (!import.meta.env.DEV || typeof window === "undefined") {
		return null;
	}
	return window as AgentPanelPerformanceCaptureWindow;
}

function isAgentPanelPerformanceCaptureEnabled(): boolean {
	return performanceCaptureWindow()?.__acepeAgentPanelPerformanceCaptureEnabled === true;
}

function resetAgentPanelPerformanceSamples(): void {
	const targetWindow = performanceCaptureWindow();
	if (targetWindow === null) {
		return;
	}
	targetWindow.__acepeAgentPanelPerformanceSamples = [];
}

function readAgentPanelPerformanceSamples(): readonly AgentPanelPerformanceSample[] {
	const targetWindow = performanceCaptureWindow();
	if (targetWindow === null) {
		return [];
	}
	return (targetWindow.__acepeAgentPanelPerformanceSamples ?? []).slice();
}

function enableAgentPanelPerformanceCapture(): void {
	resetAgentPanelPerformanceSamples();
	const targetWindow = performanceCaptureWindow();
	if (targetWindow !== null) {
		targetWindow.__acepeAgentPanelPerformanceCaptureEnabled = true;
	}
	profileCaptureEnabled = true;
}

function disableAgentPanelPerformanceCapture(): void {
	const targetWindow = performanceCaptureWindow();
	if (targetWindow !== null) {
		targetWindow.__acepeAgentPanelPerformanceCaptureEnabled = false;
	}
	profileCaptureEnabled = false;
}

function recordAgentPanelPerformanceSampleForQa(sample: AgentPanelPerformanceSample): void {
	const targetWindow = performanceCaptureWindow();
	if (targetWindow === null || !profileCaptureEnabled) {
		return;
	}
	const samples = targetWindow.__acepeAgentPanelPerformanceSamples ?? [];
	targetWindow.__acepeAgentPanelPerformanceSamples = samples;
	if (samples.length >= MAX_QA_PROFILE_SAMPLES) {
		samples.splice(0, samples.length - MAX_QA_PROFILE_SAMPLES + 1);
	}
	samples.push(sample);
}

function showReadyPlaceholder(): void {
	if (readyPlaceholderVisible) {
		return;
	}
	readyPlaceholderVisible = true;
	if (readyPlaceholderFrameId !== null) {
		cancelAnimationFrame(readyPlaceholderFrameId);
		readyPlaceholderFrameId = null;
	}
	if (readyPlaceholderFallbackTimer !== null) {
		clearTimeout(readyPlaceholderFallbackTimer);
		readyPlaceholderFallbackTimer = null;
	}
}

onMount(() => {
	readyPlaceholderFallbackTimer = setTimeout(showReadyPlaceholder, 50);
	if (typeof requestAnimationFrame === "function") {
		readyPlaceholderFrameId = requestAnimationFrame(showReadyPlaceholder);
	}
});

onDestroy(() => {
	if (readyPlaceholderFrameId !== null) {
		cancelAnimationFrame(readyPlaceholderFrameId);
		readyPlaceholderFrameId = null;
	}
	if (readyPlaceholderFallbackTimer !== null) {
		clearTimeout(readyPlaceholderFallbackTimer);
		readyPlaceholderFallbackTimer = null;
	}
});

onMount(() => {
	const targetWindow = performanceCaptureWindow();
	if (targetWindow === null) {
		return undefined;
	}
	const previousEnable = targetWindow.__acepeEnableAgentPanelPerformanceCapture;
	const previousDisable = targetWindow.__acepeDisableAgentPanelPerformanceCapture;
	const previousRead = targetWindow.__acepeReadAgentPanelPerformanceCapture;
	targetWindow.__acepeEnableAgentPanelPerformanceCapture = enableAgentPanelPerformanceCapture;
	targetWindow.__acepeDisableAgentPanelPerformanceCapture = disableAgentPanelPerformanceCapture;
	targetWindow.__acepeReadAgentPanelPerformanceCapture = readAgentPanelPerformanceSamples;
	return () => {
		profileCaptureEnabled = false;
		if (previousEnable === undefined) {
			delete targetWindow.__acepeEnableAgentPanelPerformanceCapture;
		} else {
			targetWindow.__acepeEnableAgentPanelPerformanceCapture = previousEnable;
		}
		if (previousDisable === undefined) {
			delete targetWindow.__acepeDisableAgentPanelPerformanceCapture;
		} else {
			targetWindow.__acepeDisableAgentPanelPerformanceCapture = previousDisable;
		}
		if (previousRead === undefined) {
			delete targetWindow.__acepeReadAgentPanelPerformanceCapture;
		} else {
			targetWindow.__acepeReadAgentPanelPerformanceCapture = previousRead;
		}
	};
});

// Reference to scene viewport for scroll control
let sceneViewportRef: SceneContentViewport | null = $state(null);

const liveSessionSource = $derived(
	sessionStore?.presentation.getSessionLiveWorkSource(sessionId ?? null, true) ?? {
		kind: "no_session",
	}
);
const interactionSnapshot = $derived.by(() => {
	if (!sessionId || interactionStore == null)
		return {
			pendingQuestion: null,
			pendingQuestionOperation: null,
			pendingPermission: null,
			pendingPermissionOperation: null,
			pendingComputerPermission: null,
			pendingComputerPermissionOperation: null,
			pendingPlanApproval: null,
			pendingPlanApprovalOperation: null,
		};
	return sessionStore.presentation.getSessionOperationInteractionSnapshot(sessionId, interactionStore);
});
const sessionWorkProjection = $derived.by(() => {
	if (!sessionId) {
		return null;
	}

	return deriveLiveSessionWorkProjection({
		source: liveSessionSource,
		currentModeId: sessionId ? (sessionStore?.read.getSessionCurrentModeId(sessionId) ?? null) : null,
		interactionSnapshot: {
			pendingQuestion: interactionSnapshot.pendingQuestion,
			pendingPlanApproval: interactionSnapshot.pendingPlanApproval,
			pendingComputerPermission: interactionSnapshot.pendingComputerPermission,
			pendingPermission: interactionSnapshot.pendingPermission,
		},
		hasUnseenCompletion: false,
	});
});

const runtime = $derived(
	resolveAgentPanelContentRuntime({
		liveSessionSource,
		sessionWorkProjection,
	})
);
const turnState = $derived(runtime.turnState);
const isStreaming = $derived(runtime.isStreaming);
const rowsProjection = $derived(
	rowsProjectionOverride ?? sessionStore?.viewport.getRowsProjection(sessionId) ?? null
);
const skipRowsBootstrap = $derived(rowsProjectionOverride !== null);
const hasRenderableTranscriptRows = $derived(
	sessionId !== null && rowsProjection?.sessionId === sessionId && rowsProjection.rows.length > 0
);
const shouldRenderTranscriptViewport = $derived(
	viewState.kind === "conversation" ||
		hasRenderableTranscriptRows
);

function recordSceneBoundaryMark(
	name: "agent-panel-content:scene-before" | "agent-panel-content:scene-after"
): string {
	if (name === "agent-panel-content:scene-before") {
		if (recordedSceneBeforePanelId === panelId) {
			return "";
		}
		recordedSceneBeforePanelId = panelId;
	} else {
		if (recordedSceneAfterPanelId === panelId) {
			return "";
		}
		recordedSceneAfterPanelId = panelId;
	}
	recordPanelOpenPerformanceMark(panelId, name);
	return "";
}

function recordSceneBranchMark(): string {
	if (recordedBranchPanelId === panelId) {
		return "";
	}
	recordedBranchPanelId = panelId;
	recordPanelOpenPerformanceMark(
		panelId,
		hasRenderableTranscriptRows
			? "agent-panel-content:branch-renderable"
			: viewState.kind === "conversation"
				? "agent-panel-content:branch-conversation"
				: "agent-panel-content:branch-session-shell"
	);
	return "";
}

function recordContentStateMark(name: PanelOpenPerformanceMarkName): void {
	if (recordedContentStateMarks.has(name)) {
		return;
	}
	recordedContentStateMarks.add(name);
	recordPanelOpenPerformanceMark(panelId, name);
}

// Sync streaming state to bindable prop for parent component
$effect(() => {
	isStreamingBindable = isStreaming;
});

$effect(() => {
	recordContentStateMark(
		sessionId === null
			? "agent-panel-content:input-no-session"
			: "agent-panel-content:input-session"
	);
	if (viewState.kind === "project_selection") {
		recordContentStateMark("agent-panel-content:view-project-selection");
	}
	if (viewState.kind === "error") {
		recordContentStateMark("agent-panel-content:view-error");
	}
	if (viewState.kind === "ready") {
		recordContentStateMark("agent-panel-content:view-ready");
	}
	if (viewState.kind === "conversation") {
		recordContentStateMark("agent-panel-content:view-conversation");
	}
	if (viewState.kind === "ready" && sessionId !== null) {
		recordContentStateMark("agent-panel-content:shell-eligible");
	}
});

$effect(() => {
	if (!hasRenderableTranscriptRows || sessionId === null) {
		return;
	}
	const signature = `${panelId}:${sessionId}:${rowsProjection?.emissionSeq ?? "none"}:${
		rowsProjection?.rows.length ?? 0
	}`;
	if (signature === recordedRowsReadySignature) {
		return;
	}
	recordedRowsReadySignature = signature;
	recordPanelOpenPerformanceMark(panelId, "agent-panel-content:rows-ready");
});

$effect(() => {
	if (!isAgentPanelContentTraceEnabled()) return;
	const signature = JSON.stringify({
		panelId,
		sessionId,
		viewState: viewState.kind,
		entryCount: sceneEntries?.length ?? 0,
		latestEntryId: sceneEntries?.at(-1)?.id ?? null,
		latestEntryType: sceneEntries?.at(-1)?.type ?? null,
		turnState,
	});
	if (signature === lastContentTraceSignature) {
		return;
	}
	lastContentTraceSignature = signature;
	logger.info("agent panel content props changed", JSON.parse(signature) as object);
});

// Note: isAtBottom is now updated via onNearBottomChange callback from SceneContentViewport
// This provides reactive updates on every scroll, not just on mount

// ===== PUBLIC API =====
export function scrollToBottom(options?: { force?: boolean }) {
	sceneViewportRef?.scrollToBottom(options);
}

export function prepareForNextUserReveal(options?: { force?: boolean }) {
	logger.info("prepareForNextUserReveal: content", {
		panelId,
		sessionId,
		entryCount: sceneEntries?.length ?? 0,
		latestEntryId: sceneEntries?.at(-1)?.id ?? null,
		latestEntryType: sceneEntries?.at(-1)?.type ?? null,
		force: options?.force ?? false,
	});
	sceneViewportRef?.prepareForNextUserReveal(options);
}

export function scrollToTop() {
	sceneViewportRef?.scrollToTop();
}
</script>

{#if viewState.kind === "project_selection"}
	<AgentPanelStatePanel class="overflow-y-auto" centerContent={true}>
		{#snippet children()}
			<ProjectSelectionPanel
				projects={[...allProjects]}
				preSelectedProjectPath={sessionProjectPath}
				{onProjectSelected}
			/>
		{/snippet}
	</AgentPanelStatePanel>
{:else if viewState.kind === "error" && !hasRenderableTranscriptRows}
	<AgentPanelStatePanel centerContent={true}>
		{#snippet children()}
			<div class="flex max-w-sm flex-col items-center gap-2 text-center">
				<div class="text-lg font-medium tracking-tight">{"Unable to load session"}</div>
				<div class="text-sm text-muted-foreground">{viewState.details}</div>
			</div>
		{/snippet}
	</AgentPanelStatePanel>
{:else if shouldRenderTranscriptViewport}
	<div class="h-full flex flex-col relative">
		<div class="flex-1 min-h-0">
			{recordSceneBranchMark()}
			{recordSceneBoundaryMark("agent-panel-content:scene-before")}
			<SceneContentViewport
				bind:this={sceneViewportRef}
				{panelId}
				{sceneEntries}
				{rowsProjection}
				{sessionId}
				{canonicalSource}
				{skipRowsBootstrap}
				{pendingUserRevealRequestKey}
				{showLocalPlanningIndicator}
				{planningPlaceholderPresentation}
				{turnState}
				projectPath={sessionProjectPath ?? undefined}
				{showWorkingSpark}
				{isFullscreen}
				{modifiedFilesState}
				{onQuestionSelect}
				{onPlanBuild}
				{onPlanCancel}
				{onPlanViewFull}
				{onToolFileSelect}
				{onUserFileSelect}
				{onReview}
				{isPlanActionAvailable}
				onNearBottomChange={(nearBottom) => (isAtBottom = nearBottom)}
				onNearTopChange={(nearTop) => (isAtTop = nearTop)}
				onFollowStateChange={(state) => (hasUnreadBelow = state.hasUnreadBelow)}
				{profileRecorder}
			/>
			{recordSceneBoundaryMark("agent-panel-content:scene-after")}
		</div>
	</div>
{:else if viewState.kind === "ready"}
	{#if readyPlaceholderVisible}
		<AgentPanelStatePanel centerContent={true}>
			{#snippet children()}
				<ReadyToAssistPlaceholder {agentIconSrc} {isFullscreen} />
			{/snippet}
		</AgentPanelStatePanel>
	{/if}
{/if}
