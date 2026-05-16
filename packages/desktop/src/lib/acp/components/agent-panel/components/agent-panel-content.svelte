<script lang="ts">
import { AgentPanelStatePanel } from "@acepe/ui/agent-panel";
import { LoadingIcon } from "@acepe/ui/icons";
import { mapCanonicalTurnStateToHotTurnState } from "../logic";
import { getInteractionStore } from "../../../store/interaction-store.svelte.js";
import { deriveLiveSessionWorkProjection } from "../../../store/live-session-work.js";
import { buildSessionOperationInteractionSnapshot } from "../../../store/operation-association.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import type { TurnState } from "../../../store/types.js";
import { createLogger } from "../../../utils/logger.js";
import ProjectSelectionPanel from "../../project-selection-panel.svelte";
import ReadyToAssistPlaceholder from "../../ready-to-assist-placeholder.svelte";
import type { AgentPanelContentProps } from "../types/agent-panel-content-props.js";
import SceneContentViewport from "./scene-content-viewport.svelte";

let {
	panelId,
	viewState,
	sessionId,
	sceneEntries,
	sessionProjectPath,
	allProjects = [],
	scrollContainer = $bindable(null),
	scrollViewport = $bindable(null),
	isAtBottom = $bindable(true),
	isAtTop = $bindable(true),
	isStreaming: isStreamingBindable = $bindable(false),
	onProjectSelected = () => {},
	onRetryConnection,
	onCancelConnection,
	agentIconSrc = "",
	isFullscreen = false,
	availableAgents = [],
	effectiveTheme = "dark",
	modifiedFilesState = null,
	isWaitingForResponse: isWaitingProp,
	waitingLabel = null,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	isPlanActionAvailable,
}: AgentPanelContentProps = $props();

const sessionStore = getSessionStore();
const interactionStore = getInteractionStore();
const operationStore = sessionStore?.getOperationStore?.() ?? null;
const logger = createLogger({
	id: "agent-panel-content-trace",
	name: "AgentPanelContentTrace",
});
let lastContentTraceSignature = $state<string | null>(null);

// Reference to scene viewport for scroll control
let sceneViewportRef: SceneContentViewport | null = $state(null);

// Prefer props when provided (controller pattern), fall back to store access
const runtimeState = $derived(
	isWaitingProp !== undefined
		? null
		: sessionId
			? (sessionStore?.getSessionRuntimeState(sessionId) ?? null)
			: null
);
const canonicalProjection = $derived(
	sessionId ? (sessionStore?.getCanonicalSessionProjection(sessionId) ?? null) : null
);
const currentStreamingToolCall = $derived(
	isWaitingProp !== undefined || !sessionId || operationStore === null
		? null
		: operationStore.getCurrentStreamingToolCall(sessionId)
);
const interactionSnapshot = $derived.by(() =>
	isWaitingProp !== undefined || !sessionId || operationStore === null || interactionStore == null
		? {
				pendingQuestion: null,
				pendingQuestionOperation: null,
				pendingPermission: null,
				pendingPermissionOperation: null,
				pendingPlanApproval: null,
				pendingPlanApprovalOperation: null,
			}
		: buildSessionOperationInteractionSnapshot(sessionId, operationStore, interactionStore)
);
const sessionWorkProjection = $derived.by(() => {
	if (isWaitingProp !== undefined || !sessionId) {
		return null;
	}

	return deriveLiveSessionWorkProjection({
		runtimeState,
		canonicalProjection,
		currentModeId: sessionId ? (sessionStore?.getSessionCurrentModeId(sessionId) ?? null) : null,
		currentStreamingToolCall,
		interactionSnapshot: {
			pendingQuestion: interactionSnapshot.pendingQuestion,
			pendingPlanApproval: interactionSnapshot.pendingPlanApproval,
			pendingPermission: interactionSnapshot.pendingPermission,
		},
		hasUnseenCompletion: false,
	});
});

const turnState = $derived<TurnState>(
	canonicalProjection != null ? mapCanonicalTurnStateToHotTurnState(canonicalProjection.turnState) : "idle"
);
const isStreaming = $derived(turnState === "streaming");
const isWaitingForResponse = $derived(
	isWaitingProp ?? sessionWorkProjection?.canonicalActivity === "awaiting_model"
);

// Sync streaming state to bindable prop for parent component
$effect(() => {
	isStreamingBindable = isStreaming;
});

$effect(() => {
	if (!import.meta.env.DEV) return;
	const signature = JSON.stringify({
		panelId,
		sessionId,
		viewState: viewState.kind,
		entryCount: sceneEntries?.length ?? 0,
		latestEntryId: sceneEntries?.at(-1)?.id ?? null,
		latestEntryType: sceneEntries?.at(-1)?.type ?? null,
		turnState,
		isWaitingForResponse,
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
{:else if viewState.kind === "error"}
	<AgentPanelStatePanel centerContent={true}>
		{#snippet children()}
			<div class="flex max-w-sm flex-col items-center gap-2 text-center">
				<div class="text-lg font-medium tracking-tight">{"Unable to load session"}</div>
				<div class="text-sm text-muted-foreground">{viewState.details}</div>
			</div>
		{/snippet}
	</AgentPanelStatePanel>
{:else if viewState.kind === "conversation"}
	<div class="h-full flex flex-col relative">
		<div class="flex-1 min-h-0">
			<SceneContentViewport
				bind:this={sceneViewportRef}
				{panelId}
				{sceneEntries}
				{sessionId}
				{turnState}
				{isWaitingForResponse}
				{waitingLabel}
				projectPath={sessionProjectPath ?? undefined}
				{isFullscreen}
				{modifiedFilesState}
				{onQuestionSelect}
				{onPlanBuild}
				{onPlanCancel}
				{onPlanViewFull}
				{isPlanActionAvailable}
				onNearBottomChange={(nearBottom) => (isAtBottom = nearBottom)}
				onNearTopChange={(nearTop) => (isAtTop = nearTop)}
			/>
		</div>
	</div>
{:else if viewState.kind === "loading"}
	<AgentPanelStatePanel centerContent={true}>
		{#snippet children()}
			<div class="flex h-full w-full items-center justify-center">
				<LoadingIcon class="size-10" aria-label="Loading session" />
			</div>
		{/snippet}
	</AgentPanelStatePanel>
{:else if viewState.kind === "ready"}
	<AgentPanelStatePanel centerContent={true}>
		{#snippet children()}
			<ReadyToAssistPlaceholder {agentIconSrc} {isFullscreen} />
		{/snippet}
	</AgentPanelStatePanel>
{/if}
