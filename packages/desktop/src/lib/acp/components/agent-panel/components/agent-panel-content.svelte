<script lang="ts">
import { AgentPanelStatePanel } from "@acepe/ui/agent-panel";
import { getInteractionStore } from "../../../store/interaction-store.svelte.js";
import {
	deriveLiveSessionWorkProjection,
} from "../../../store/live-session-work.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import { createLogger } from "../../../utils/logger.js";
import ProjectSelectionPanel from "../../project-selection-panel.svelte";
import ReadyToAssistPlaceholder from "../../ready-to-assist-placeholder.svelte";
import { resolveAgentPanelContentRuntime } from "../logic/agent-panel-content-runtime.js";
import type { AgentPanelContentProps } from "../types/agent-panel-content-props.js";
import SceneContentViewport from "./scene-content-viewport.svelte";

let {
	panelId,
	viewState,
	sessionId,
	sceneEntries,
	pendingUserRevealRequestKey = null,
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
	onToolFileSelect,
	isPlanActionAvailable,
}: AgentPanelContentProps = $props();

const sessionStore = getSessionStore();
const interactionStore = getInteractionStore();
const logger = createLogger({
	id: "agent-panel-content-trace",
	name: "AgentPanelContentTrace",
});
let lastContentTraceSignature = $state<string | null>(null);

// Reference to scene viewport for scroll control
let sceneViewportRef: SceneContentViewport | null = $state(null);

const liveSessionSource = $derived(
	sessionStore?.getSessionLiveWorkSource(sessionId ?? null, true) ?? { kind: "no_session" }
);
const interactionSnapshot = $derived.by(() =>
	isWaitingProp !== undefined || !sessionId || interactionStore == null
		? {
				pendingQuestion: null,
				pendingQuestionOperation: null,
				pendingPermission: null,
				pendingPermissionOperation: null,
				pendingPlanApproval: null,
				pendingPlanApprovalOperation: null,
			}
		: sessionStore.getSessionOperationInteractionSnapshot(sessionId, interactionStore)
);
const sessionWorkProjection = $derived.by(() => {
	if (isWaitingProp !== undefined || !sessionId) {
		return null;
	}

	return deriveLiveSessionWorkProjection({
		source: liveSessionSource,
		currentModeId: sessionId ? (sessionStore?.getSessionCurrentModeId(sessionId) ?? null) : null,
		interactionSnapshot: {
			pendingQuestion: interactionSnapshot.pendingQuestion,
			pendingPlanApproval: interactionSnapshot.pendingPlanApproval,
			pendingPermission: interactionSnapshot.pendingPermission,
		},
		hasUnseenCompletion: false,
	});
});

const runtime = $derived(
	resolveAgentPanelContentRuntime({
		liveSessionSource,
		explicitWaiting: isWaitingProp,
		sessionWorkProjection,
	})
);
const turnState = $derived(runtime.turnState);
const isStreaming = $derived(runtime.isStreaming);
const isWaitingForResponse = $derived(runtime.isWaitingForResponse);

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
				{pendingUserRevealRequestKey}
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
				{onToolFileSelect}
				{isPlanActionAvailable}
				onNearBottomChange={(nearBottom) => (isAtBottom = nearBottom)}
				onNearTopChange={(nearTop) => (isAtTop = nearTop)}
			/>
		</div>
	</div>
{:else if viewState.kind === "ready"}
	<AgentPanelStatePanel centerContent={true}>
		{#snippet children()}
			<ReadyToAssistPlaceholder {agentIconSrc} {isFullscreen} />
		{/snippet}
	</AgentPanelStatePanel>
{/if}
